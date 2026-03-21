#ifndef _INCLUDE_FT4_SYNC_H_
#define _INCLUDE_FT4_SYNC_H_

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    float freq_hz;
    float time_offset;
    float score;
} ft4_candidate_t;

int ft4_find_candidates(const float* signal, int num_samples,
                        ft4_candidate_t* candidates, int max_candidates);

#ifdef __cplusplus
}
#endif

#endif /* _INCLUDE_FT4_SYNC_H_ */
