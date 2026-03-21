#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <math.h>
#include <stdbool.h>

#include "ft8/message.h"
#include "ft8/constants.h"
#include "ft8/crc.h"
#include "ft8/ldpc.h"

#include "ft4_constants.h"
#include "ft4_sync.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

/* Callsign hash table */
#define CALLSIGN_HASHTABLE_SIZE 256

static struct {
    char callsign[12];
    uint32_t hash;
} cs_hashtable[CALLSIGN_HASHTABLE_SIZE];

static int cs_hashtable_size;

static void hashtable_init(void)
{
    cs_hashtable_size = 0;
    memset(cs_hashtable, 0, sizeof(cs_hashtable));
}

static void hashtable_cleanup(uint8_t max_age)
{
    for (int i = 0; i < CALLSIGN_HASHTABLE_SIZE; ++i)
    {
        if (cs_hashtable[i].callsign[0] != '\0')
        {
            uint8_t age = (uint8_t)(cs_hashtable[i].hash >> 24);
            if (age > max_age)
            {
                cs_hashtable[i].callsign[0] = '\0';
                cs_hashtable[i].hash = 0;
                cs_hashtable_size--;
            }
            else
            {
                cs_hashtable[i].hash = (((uint32_t)age + 1u) << 24) |
                                       (cs_hashtable[i].hash & 0x3FFFFFu);
            }
        }
    }
}

static void hashtable_add(const char* callsign, uint32_t hash)
{
    uint16_t hash10 = (hash >> 12) & 0x3FFu;
    int idx = (hash10 * 23) % CALLSIGN_HASHTABLE_SIZE;
    while (cs_hashtable[idx].callsign[0] != '\0')
    {
        if (((cs_hashtable[idx].hash & 0x3FFFFFu) == hash) &&
            (0 == strcmp(cs_hashtable[idx].callsign, callsign)))
        {
            cs_hashtable[idx].hash &= 0x3FFFFFu;
            return;
        }
        idx = (idx + 1) % CALLSIGN_HASHTABLE_SIZE;
    }
    cs_hashtable_size++;
    strncpy(cs_hashtable[idx].callsign, callsign, 11);
    cs_hashtable[idx].callsign[11] = '\0';
    cs_hashtable[idx].hash = hash;
}

static bool hashtable_lookup(ftx_callsign_hash_type_t hash_type,
                              uint32_t hash, char* callsign)
{
    uint8_t hash_shift = (hash_type == FTX_CALLSIGN_HASH_10_BITS) ? 12 :
                         (hash_type == FTX_CALLSIGN_HASH_12_BITS ? 10 : 0);
    uint16_t hash10 = (hash >> (12 - hash_shift)) & 0x3FFu;
    int idx = (hash10 * 23) % CALLSIGN_HASHTABLE_SIZE;
    while (cs_hashtable[idx].callsign[0] != '\0')
    {
        if (((cs_hashtable[idx].hash & 0x3FFFFFu) >> hash_shift) == hash)
        {
            strcpy(callsign, cs_hashtable[idx].callsign);
            return true;
        }
        idx = (idx + 1) % CALLSIGN_HASHTABLE_SIZE;
    }
    callsign[0] = '\0';
    return false;
}

static ftx_callsign_hash_interface_t hash_if = {
    .lookup_hash = hashtable_lookup,
    .save_hash = hashtable_add
};

static void extract_soft_bits(const float* signal, int num_samples,
                               float freq_hz, float time_offset,
                               float* log174)
{
    int ds_len = num_samples / FT4_DS_FACTOR;
    float* ds_i = (float*)calloc(ds_len, sizeof(float));
    float* ds_q = (float*)calloc(ds_len, sizeof(float));
    if (!ds_i || !ds_q) { free(ds_i); free(ds_q); return; }

    float phase = 0.0f;
    float dphi = 2.0f * M_PI * freq_hz / FT4_SAMPLE_RATE;
    for (int k = 0; k < ds_len; ++k)
    {
        float sum_i = 0.0f, sum_q = 0.0f;
        int base = k * FT4_DS_FACTOR;
        for (int j = 0; j < FT4_DS_FACTOR && (base + j) < num_samples; ++j)
        {
            float s = signal[base + j];
            float p = phase + dphi * j;
            sum_i += s * cosf(p);
            sum_q += s * (-sinf(p));
        }
        ds_i[k] = sum_i / FT4_DS_FACTOR;
        ds_q[k] = sum_q / FT4_DS_FACTOR;
        phase += dphi * FT4_DS_FACTOR;
        phase = fmodf(phase, 2.0f * M_PI);
    }

    int t0 = (int)(time_offset / FT4_DS_FACTOR + 0.5f);
    int spsym = FT4_DS_SPSYM;

    static const int data_offsets[3] = { FT4_DATA_POS_0, FT4_DATA_POS_1, FT4_DATA_POS_2 };
    int bit_idx = 0;

    for (int blk = 0; blk < 3; ++blk)
    {
        for (int s = 0; s < 29; ++s)
        {
            int sym_pos = data_offsets[blk] + s;
            int sample_start = t0 + sym_pos * spsym;

            float mag[4] = {0};
            for (int tone = 0; tone < 4; ++tone)
            {
                float freq_norm = (float)tone / spsym;
                float sr = 0.0f, si = 0.0f;
                for (int j = 0; j < spsym; ++j)
                {
                    int idx = sample_start + j;
                    if (idx < 0 || idx >= ds_len) continue;
                    float angle = 2.0f * M_PI * freq_norm * j;
                    sr += ds_i[idx] * cosf(angle) + ds_q[idx] * sinf(angle);
                    si += ds_q[idx] * cosf(angle) - ds_i[idx] * sinf(angle);
                }
                mag[tone] = sr * sr + si * si;
            }

            float p_hi = mag[2] + mag[3];
            float p_lo = mag[0] + mag[1];
            float llr_bit1 = (p_lo > 0 && p_hi > 0) ?
                              logf(p_hi / p_lo) : ((p_hi > p_lo) ? 4.0f : -4.0f);

            float p_mid = mag[1] + mag[2];
            float p_out = mag[0] + mag[3];
            float llr_bit0 = (p_out > 0 && p_mid > 0) ?
                              logf(p_mid / p_out) : ((p_mid > p_out) ? 4.0f : -4.0f);

            if (llr_bit1 > 6.0f) llr_bit1 = 6.0f;
            if (llr_bit1 < -6.0f) llr_bit1 = -6.0f;
            if (llr_bit0 > 6.0f) llr_bit0 = 6.0f;
            if (llr_bit0 < -6.0f) llr_bit0 = -6.0f;

            log174[bit_idx++] = llr_bit1;
            log174[bit_idx++] = llr_bit0;
        }
    }

    free(ds_i);
    free(ds_q);
}

static int decode_initialized = 0;

void ft4_init_decode(void)
{
    hashtable_init();
    decode_initialized = 1;
}

void ft4_exec_decode(float* signal, int num_samples, char* results)
{
    if (!decode_initialized)
        ft4_init_decode();

    memset(results, 0, 4096);

    ft4_candidate_t candidates[FT4_MAX_CANDIDATES];
    int n_cand = ft4_find_candidates(signal, num_samples,
                                      candidates, FT4_MAX_CANDIDATES);

    int num_decoded = 0;
    ftx_message_t decoded[FT4_MAX_DECODED];
    ftx_message_t* decoded_ht[FT4_MAX_DECODED];
    for (int i = 0; i < FT4_MAX_DECODED; ++i)
        decoded_ht[i] = NULL;

    for (int idx = 0; idx < n_cand; ++idx)
    {
        float freq = candidates[idx].freq_hz;
        float t_off = candidates[idx].time_offset;
        float score = candidates[idx].score;

        float log174[FTX_LDPC_N];
        memset(log174, 0, sizeof(log174));
        extract_soft_bits(signal, num_samples, freq, t_off, log174);

        uint8_t plain[FTX_LDPC_N];
        int ok = 0;
        bp_decode(log174, FT4_LDPC_ITERS, plain, &ok);
        if (ok != 0)
            continue;

        uint8_t a91[FTX_LDPC_K_BYTES];
        memset(a91, 0, sizeof(a91));
        for (int i = 0; i < FTX_LDPC_K; ++i)
        {
            if (plain[i])
                a91[i / 8] |= (0x80u >> (i % 8));
        }

        uint16_t crc_extracted = ftx_extract_crc(a91);
        a91[9] &= 0xF8u;
        a91[10] = 0;
        a91[11] = 0;
        uint16_t crc_computed = ftx_compute_crc(a91, 96 - 14);
        if (crc_extracted != crc_computed)
            continue;

        a91[9] |= (uint8_t)(crc_extracted >> 11);
        a91[10] = (uint8_t)(crc_extracted >> 3);
        a91[11] = (uint8_t)(crc_extracted << 5);

        uint8_t payload[10];
        for (int i = 0; i < 10; ++i)
            payload[i] = a91[i] ^ kFT4_XOR_sequence[i];
        payload[9] = (payload[9] & 0xF8u) | (a91[9] & 0x07u);

        ftx_message_t message;
        memcpy(message.payload, payload, 10);
        message.hash = 0;
        for (int i = 0; i < 10; ++i)
            message.hash = message.hash * 31 + payload[i];

        int idx_hash = message.hash % FT4_MAX_DECODED;
        bool found_empty = false, found_dup = false;
        do {
            if (decoded_ht[idx_hash] == NULL) found_empty = true;
            else if (decoded_ht[idx_hash]->hash == message.hash &&
                     0 == memcmp(decoded_ht[idx_hash]->payload, message.payload, 10))
                found_dup = true;
            else
                idx_hash = (idx_hash + 1) % FT4_MAX_DECODED;
        } while (!found_empty && !found_dup);

        if (found_dup) continue;

        memcpy(&decoded[idx_hash], &message, sizeof(message));
        decoded_ht[idx_hash] = &decoded[idx_hash];
        ++num_decoded;

        char text[FTX_MAX_MESSAGE_LENGTH];
        ftx_message_rc_t unpack_rc = ftx_message_decode(&message, &hash_if, text, NULL);
        if (unpack_rc != FTX_MESSAGE_RC_OK)
            snprintf(text, sizeof(text), "Error [%d]", (int)unpack_rc);

        float snr = score * 0.5f - 4.0f;
        float dt = t_off / FT4_SAMPLE_RATE;

        char line[FTX_MAX_MESSAGE_LENGTH + 32];
        snprintf(line, sizeof(line), "%f,%f,%f,%s\n", snr, dt, freq, text);
        strncat(results, line, 4096 - strlen(results) - 1);
    }

    hashtable_cleanup(10);
}
