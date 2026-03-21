#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <math.h>

#include "ft4_constants.h"
#include "ft4_sync.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static void downmix_decimate(const float* signal, int num_samples,
                              float freq_hz, float* out_i, float* out_q,
                              int out_len)
{
    float phase = 0.0f;
    float dphi = 2.0f * M_PI * freq_hz / FT4_SAMPLE_RATE;

    for (int k = 0; k < out_len; ++k)
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
        out_i[k] = sum_i / FT4_DS_FACTOR;
        out_q[k] = sum_q / FT4_DS_FACTOR;
        phase += dphi * FT4_DS_FACTOR;
        phase = fmodf(phase, 2.0f * M_PI);
    }
}

static int estimate_tone(const float* ds_i, const float* ds_q,
                          int sym_start, int spsym)
{
    float best_mag = -1.0f;
    int best_tone = 0;

    for (int tone = 0; tone < 4; ++tone)
    {
        float freq = (float)tone / spsym;
        float sum_r = 0.0f, sum_i = 0.0f;
        for (int j = 0; j < spsym; ++j)
        {
            int idx = sym_start + j;
            float angle = 2.0f * M_PI * freq * j;
            float cos_a = cosf(angle);
            float sin_a = sinf(angle);
            sum_r += ds_i[idx] * cos_a + ds_q[idx] * sin_a;
            sum_i += ds_q[idx] * cos_a - ds_i[idx] * sin_a;
        }
        float mag = sum_r * sum_r + sum_i * sum_i;
        if (mag > best_mag)
        {
            best_mag = mag;
            best_tone = tone;
        }
    }
    return best_tone;
}

static float compute_sync_score(const float* ds_i, const float* ds_q,
                                 int time_offset, int ds_len)
{
    static const int sync_pos[4] = {
        FT4_SYNC_POS_A, FT4_SYNC_POS_B, FT4_SYNC_POS_C, FT4_SYNC_POS_D
    };
    int spsym = FT4_DS_SPSYM;
    int score = 0;

    for (int g = 0; g < 4; ++g)
    {
        for (int s = 0; s < FT4_LENGTH_SYNC; ++s)
        {
            int sym_idx = sync_pos[g] + s;
            int sample_start = time_offset + sym_idx * spsym;

            if (sample_start < 0 || sample_start + spsym > ds_len)
                continue;

            int tone = estimate_tone(ds_i, ds_q, sample_start, spsym);
            if (tone == kFT4_Costas_pattern[g][s])
                score++;
        }
    }
    return (float)score;
}

static int cmp_candidates(const void* a, const void* b)
{
    float sa = ((const ft4_candidate_t*)a)->score;
    float sb = ((const ft4_candidate_t*)b)->score;
    if (sb > sa) return 1;
    if (sb < sa) return -1;
    return 0;
}

int ft4_find_candidates(const float* signal, int num_samples,
                        ft4_candidate_t* candidates, int max_candidates)
{
    int ds_len = num_samples / FT4_DS_FACTOR;
    float* ds_i = (float*)calloc(ds_len, sizeof(float));
    float* ds_q = (float*)calloc(ds_len, sizeof(float));
    if (!ds_i || !ds_q) { free(ds_i); free(ds_q); return 0; }

    int max_tmp = 2000;
    ft4_candidate_t* tmp = (ft4_candidate_t*)calloc(max_tmp, sizeof(ft4_candidate_t));
    if (!tmp) { free(ds_i); free(ds_q); return 0; }
    int n_tmp = 0;

    for (float freq = FT4_FREQ_MIN; freq <= FT4_FREQ_MAX; freq += FT4_FREQ_STEP)
    {
        downmix_decimate(signal, num_samples, freq, ds_i, ds_q, ds_len);

        int frame_ds = FT4_NN * FT4_DS_SPSYM;
        int max_offset = ds_len - frame_ds;
        int time_step = FT4_DS_SPSYM / 4;
        if (time_step < 1) time_step = 1;

        for (int t = 0; t <= max_offset; t += time_step)
        {
            float score = compute_sync_score(ds_i, ds_q, t, ds_len);
            if (score >= FT4_MIN_SYNC_SCORE && n_tmp < max_tmp)
            {
                tmp[n_tmp].freq_hz = freq;
                tmp[n_tmp].time_offset = (float)(t * FT4_DS_FACTOR);
                tmp[n_tmp].score = score;
                n_tmp++;
            }
        }
    }

    qsort(tmp, n_tmp, sizeof(ft4_candidate_t), cmp_candidates);

    int n_cand = 0;
    for (int i = 0; i < n_tmp && n_cand < max_candidates; ++i)
    {
        int dup = 0;
        for (int j = 0; j < n_cand; ++j)
        {
            float df = fabsf(tmp[i].freq_hz - candidates[j].freq_hz);
            float dt = fabsf(tmp[i].time_offset - candidates[j].time_offset);
            if (df < FT4_FREQ_STEP * 1.5f && dt < FT4_SAMPLES_PER_SYM * 2.0f)
            {
                dup = 1;
                break;
            }
        }
        if (!dup)
            candidates[n_cand++] = tmp[i];
    }

    free(tmp);
    free(ds_i);
    free(ds_q);
    return n_cand;
}
