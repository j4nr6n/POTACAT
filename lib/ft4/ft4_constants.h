#ifndef _INCLUDE_FT4_CONSTANTS_H_
#define _INCLUDE_FT4_CONSTANTS_H_

#include <stdint.h>
#include "ft8/constants.h"  /* FT4_NN, FT4_ND, FT4_NR, kFT4_Costas, kFT4_Gray_map, kFT4_XOR_sequence etc. */

#ifdef __cplusplus
extern "C" {
#endif

/* FT4 audio/decoder parameters (not in ft8_lib) */
#define FT4_SAMPLE_RATE     12000
#define FT4_SAMPLES_PER_SYM 576                   /* 12000 * 0.048 */
#define FT4_SYMBOL_BT       1.0f

#define FT4_TX_SAMPLES      60480                 /* 105 * 576 */
#define FT4_INPUT_SAMPLES   90000                 /* 7.5s buffer */
#define FT4_CYCLE_SEC       7.5f

/* Sync symbol positions within the 105-symbol frame */
#define FT4_SYNC_POS_A      1
#define FT4_SYNC_POS_B      34
#define FT4_SYNC_POS_C      67
#define FT4_SYNC_POS_D      100

/* Data symbol positions: 5-33, 38-66, 71-99 */
#define FT4_DATA_POS_0      5
#define FT4_DATA_POS_1      38
#define FT4_DATA_POS_2      71

/* Decoder tuning */
#define FT4_LDPC_ITERS      25
#define FT4_MAX_CANDIDATES  120
#define FT4_MAX_DECODED     50
#define FT4_MIN_SYNC_SCORE  10
#define FT4_FREQ_MIN        200.0f
#define FT4_FREQ_MAX        3000.0f
#define FT4_FREQ_STEP       20.0f

/* Downsampled decoder parameters
 * FT4: 576 samples/sym, decimate 9:1 -> 64 samples/sym at 1333 Hz */
#define FT4_DS_RATE         1333
#define FT4_DS_FACTOR       9
#define FT4_DS_SPSYM        64
#define FT4_FFT_SIZE        64

#ifdef __cplusplus
}
#endif

#endif /* _INCLUDE_FT4_CONSTANTS_H_ */
