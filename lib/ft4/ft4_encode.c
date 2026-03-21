#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <math.h>
#include <stdbool.h>

#include "ft8/message.h"
#include "ft8/encode.h"
#include "ft8/crc.h"
#include "ft8/constants.h"
#include "ft4_constants.h"

#define GFSK_CONST_K 5.336446f

static void gfsk_pulse(int n_spsym, float symbol_bt, float* pulse)
{
    for (int i = 0; i < 3 * n_spsym; ++i)
    {
        float t = i / (float)n_spsym - 1.5f;
        float arg1 = GFSK_CONST_K * symbol_bt * (t + 0.5f);
        float arg2 = GFSK_CONST_K * symbol_bt * (t - 0.5f);
        pulse[i] = (erff(arg1) - erff(arg2)) / 2;
    }
}

static void synth_gfsk(const uint8_t* symbols, int n_sym, float f0,
                        float symbol_bt, float symbol_period,
                        int signal_rate, float* signal)
{
    int n_spsym = (int)(0.5f + signal_rate * symbol_period);
    int n_wave = n_sym * n_spsym;
    float hmod = 1.0f;

    float dphi_peak = 2 * M_PI * hmod / n_spsym;
    float dphi[n_wave + 2 * n_spsym];

    for (int i = 0; i < n_wave + 2 * n_spsym; ++i)
        dphi[i] = 2 * M_PI * f0 / signal_rate;

    float pulse[3 * n_spsym];
    gfsk_pulse(n_spsym, symbol_bt, pulse);

    for (int i = 0; i < n_sym; ++i)
    {
        int ib = i * n_spsym;
        for (int j = 0; j < 3 * n_spsym; ++j)
            dphi[j + ib] += dphi_peak * symbols[i] * pulse[j];
    }

    for (int j = 0; j < 2 * n_spsym; ++j)
    {
        dphi[j] += dphi_peak * pulse[j + n_spsym] * symbols[0];
        dphi[j + n_sym * n_spsym] += dphi_peak * pulse[j] * symbols[n_sym - 1];
    }

    float phi = 0;
    for (int k = 0; k < n_wave; ++k)
    {
        signal[k] = sinf(phi);
        phi = fmodf(phi + dphi[k + n_spsym], 2 * M_PI);
    }

    int n_ramp = n_spsym / 8;
    for (int i = 0; i < n_ramp; ++i)
    {
        float env = (1 - cosf(2 * M_PI * i / (2 * n_ramp))) / 2;
        signal[i] *= env;
        signal[n_wave - 1 - i] *= env;
    }
}

int ft4_exec_encode(char* message, float frequency, float* signal)
{
    ftx_message_t msg;
    ftx_message_rc_t rc = ftx_message_encode(&msg, NULL, message);
    if (rc != FTX_MESSAGE_RC_OK)
        return -2;

    uint8_t payload_xor[10];
    for (int i = 0; i < 10; ++i)
        payload_xor[i] = msg.payload[i] ^ kFT4_XOR_sequence[i];

    uint8_t a91[FTX_LDPC_K_BYTES];
    ftx_add_crc(payload_xor, a91);

    uint8_t codeword[FTX_LDPC_N_BYTES];
    for (int j = 0; j < FTX_LDPC_N_BYTES; ++j)
        codeword[j] = (j < FTX_LDPC_K_BYTES) ? a91[j] : 0;

    uint8_t col_mask = (0x80u >> (FTX_LDPC_K % 8u));
    uint8_t col_idx = FTX_LDPC_K_BYTES - 1;
    for (int i = 0; i < FTX_LDPC_M; ++i)
    {
        uint8_t nsum = 0;
        for (int j = 0; j < FTX_LDPC_K_BYTES; ++j)
        {
            uint8_t bits = a91[j] & kFTX_LDPC_generator[i][j];
            bits ^= bits >> 4;
            bits ^= bits >> 2;
            bits ^= bits >> 1;
            nsum ^= (bits & 1);
        }
        if (nsum)
            codeword[col_idx] |= col_mask;
        col_mask >>= 1;
        if (col_mask == 0) { col_mask = 0x80u; ++col_idx; }
    }

    uint8_t data_tones[FT4_ND];
    uint8_t mask = 0x80u;
    int i_byte = 0;
    for (int i = 0; i < FT4_ND; ++i)
    {
        uint8_t bits2 = 0;
        if (codeword[i_byte] & mask) bits2 |= 2;
        if (0 == (mask >>= 1)) { mask = 0x80u; i_byte++; }
        if (codeword[i_byte] & mask) bits2 |= 1;
        if (0 == (mask >>= 1)) { mask = 0x80u; i_byte++; }
        data_tones[i] = kFT4_Gray_map[bits2];
    }

    uint8_t tones[FT4_NN];
    int di = 0;

    for (int i = 0; i < FT4_NN; ++i)
    {
        if (i == 0 || i == 104)
            tones[i] = 0;
        else if (i >= FT4_SYNC_POS_A && i < FT4_SYNC_POS_A + FT4_LENGTH_SYNC)
            tones[i] = kFT4_Costas_pattern[0][i - FT4_SYNC_POS_A];
        else if (i >= FT4_SYNC_POS_B && i < FT4_SYNC_POS_B + FT4_LENGTH_SYNC)
            tones[i] = kFT4_Costas_pattern[1][i - FT4_SYNC_POS_B];
        else if (i >= FT4_SYNC_POS_C && i < FT4_SYNC_POS_C + FT4_LENGTH_SYNC)
            tones[i] = kFT4_Costas_pattern[2][i - FT4_SYNC_POS_C];
        else if (i >= FT4_SYNC_POS_D && i < FT4_SYNC_POS_D + FT4_LENGTH_SYNC)
            tones[i] = kFT4_Costas_pattern[3][i - FT4_SYNC_POS_D];
        else
            tones[i] = data_tones[di++];
    }

    memset(signal, 0, FT4_TX_SAMPLES * sizeof(float));
    synth_gfsk(tones, FT4_NN, frequency, FT4_SYMBOL_BT,
               FT4_SYMBOL_PERIOD, FT4_SAMPLE_RATE, signal);

    return 0;
}
