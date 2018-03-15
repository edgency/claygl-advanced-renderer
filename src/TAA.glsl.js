export default "\n@export car.taa\n#define SHADER_NAME TAA\n#define FLT_EPS 0.00000001\n#define MINMAX_4TAP_VARYING\n#define USE_CLIPPING\n#define USE_YCOCG\n#define USE_DILATION\nuniform sampler2D prevTex;\nuniform sampler2D currTex;\nuniform sampler2D velocityTex;\nuniform sampler2D depthTex;\nuniform bool still;\nuniform float sinTime;\nuniform float motionScale : 0.1;\nuniform float feedbackMin: 0.88;\nuniform float feedbackMax: 0.97;\nuniform mat4 projection;\nuniform vec2 texelSize;\nuniform vec2 depthTexelSize;\nvarying vec2 v_Texcoord;\nconst vec3 w = vec3(0.2125, 0.7154, 0.0721);\nfloat depth_resolve_linear(float depth) {\n if (projection[3][3] == 0.0) {\n return projection[3][2] / (depth * projection[2][3] - projection[2][2]);\n }\n else {\n return (depth - projection[3][2]) / projection[2][2];\n }\n}\nvec3 find_closest_fragment_3x3(vec2 uv)\n{\n\tvec2 dd = abs(depthTexelSize.xy);\n\tvec2 du = vec2(dd.x, 0.0);\n\tvec2 dv = vec2(0.0, dd.y);\n\tvec3 dtl = vec3(-1, -1, texture2D(depthTex, uv - dv - du).x);\n\tvec3 dtc = vec3( 0, -1, texture2D(depthTex, uv - dv).x);\n\tvec3 dtr = vec3( 1, -1, texture2D(depthTex, uv - dv + du).x);\n\tvec3 dml = vec3(-1, 0, texture2D(depthTex, uv - du).x);\n\tvec3 dmc = vec3( 0, 0, texture2D(depthTex, uv).x);\n\tvec3 dmr = vec3( 1, 0, texture2D(depthTex, uv + du).x);\n\tvec3 dbl = vec3(-1, 1, texture2D(depthTex, uv + dv - du).x);\n\tvec3 dbc = vec3( 0, 1, texture2D(depthTex, uv + dv).x);\n\tvec3 dbr = vec3( 1, 1, texture2D(depthTex, uv + dv + du).x);\n\tvec3 dmin = dtl;\n\tif (dmin.z > dtc.z) dmin = dtc;\n\tif (dmin.z > dtr.z) dmin = dtr;\n\tif (dmin.z > dml.z) dmin = dml;\n\tif (dmin.z > dmc.z) dmin = dmc;\n\tif (dmin.z > dmr.z) dmin = dmr;\n\tif (dmin.z > dbl.z) dmin = dbl;\n\tif (dmin.z > dbc.z) dmin = dbc;\n\tif (dmin.z > dbr.z) dmin = dbr;\n\treturn vec3(uv + dd.xy * dmin.xy, dmin.z);\n}\nfloat PDnrand( vec2 n ) {\n\treturn fract( sin(dot(n.xy, vec2(12.9898, 78.233)))* 43758.5453 );\n}\nvec2 PDnrand2( vec2 n ) {\n\treturn fract( sin(dot(n.xy, vec2(12.9898, 78.233)))* vec2(43758.5453, 28001.8384) );\n}\nvec3 PDnrand3( vec2 n ) {\n\treturn fract( sin(dot(n.xy, vec2(12.9898, 78.233)))* vec3(43758.5453, 28001.8384, 50849.4141 ) );\n}\nvec4 PDnrand4( vec2 n ) {\n\treturn fract( sin(dot(n.xy, vec2(12.9898, 78.233)))* vec4(43758.5453, 28001.8384, 50849.4141, 12996.89) );\n}\nfloat PDsrand( vec2 n ) {\n\treturn PDnrand( n ) * 2.0 - 1.0;\n}\nvec2 PDsrand2( vec2 n ) {\n\treturn PDnrand2( n ) * 2.0 - 1.0;\n}\nvec3 PDsrand3( vec2 n ) {\n\treturn PDnrand3( n ) * 2.0 - 1.0;\n}\nvec4 PDsrand4( vec2 n ) {\n\treturn PDnrand4( n ) * 2.0 - 1.0;\n}\nvec3 RGB_YCoCg(vec3 c)\n{\n return vec3(\n c.x/4.0 + c.y/2.0 + c.z/4.0,\n c.x/2.0 - c.z/2.0,\n -c.x/4.0 + c.y/2.0 - c.z/4.0\n );\n}\nvec3 YCoCg_RGB(vec3 c)\n{\n return clamp(vec3(\n c.x + c.y - c.z,\n c.x + c.z,\n c.x - c.y - c.z\n ), vec3(0.0), vec3(1.0));\n}\nvec4 sample_color(sampler2D tex, vec2 uv)\n{\n#ifdef USE_YCOCG\n vec4 c = texture2D(tex, uv);\n return vec4(RGB_YCoCg(c.rgb), c.a);\n#else\n return texture2D(tex, uv);\n#endif\n}\nvec4 resolve_color(vec4 c)\n{\n#ifdef USE_YCOCG\n return vec4(YCoCg_RGB(c.rgb).rgb, c.a);\n#else\n return c;\n#endif\n}\nvec4 clip_aabb(vec3 aabb_min, vec3 aabb_max, vec4 p, vec4 q)\n{\n vec3 p_clip = 0.5 * (aabb_max + aabb_min);\n vec3 e_clip = 0.5 * (aabb_max - aabb_min) + FLT_EPS;\n vec4 v_clip = q - vec4(p_clip, p.w);\n vec3 v_unit = v_clip.xyz / e_clip;\n vec3 a_unit = abs(v_unit);\n float ma_unit = max(a_unit.x, max(a_unit.y, a_unit.z));\n if (ma_unit > 1.0)\n return vec4(p_clip, p.w) + v_clip / ma_unit;\n else\n return q;\n}\nvec4 sample_color_motion(sampler2D tex, vec2 uv, vec2 ss_vel)\n{\n vec2 v = 0.5 * ss_vel;\n float srand = PDsrand(uv + vec2(sinTime));\n vec2 vtap = v / 3.0;\n vec2 pos0 = uv + vtap * (0.5 * srand);\n vec4 accu = vec4(0.0);\n float wsum = 0.0;\n for (int i = -3; i <= 3; i++)\n {\n float w = 1.0; accu += w * sample_color(tex, pos0 + float(i) * vtap);\n wsum += w;\n }\n return accu / wsum;\n}\nvec4 temporal_reprojection(vec2 ss_txc, vec2 ss_vel, float vs_dist)\n{\n vec4 texel0 = sample_color(currTex, ss_txc);\n vec4 texel1 = sample_color(prevTex, ss_txc - ss_vel);\n vec2 uv = ss_txc;\n#if defined(MINMAX_3X3) || defined(MINMAX_3X3_ROUNDED)\n vec2 du = vec2(texelSize.x, 0.0);\n vec2 dv = vec2(0.0, texelSize.y);\n vec4 ctl = sample_color(currTex, uv - dv - du);\n vec4 ctc = sample_color(currTex, uv - dv);\n vec4 ctr = sample_color(currTex, uv - dv + du);\n vec4 cml = sample_color(currTex, uv - du);\n vec4 cmc = sample_color(currTex, uv);\n vec4 cmr = sample_color(currTex, uv + du);\n vec4 cbl = sample_color(currTex, uv + dv - du);\n vec4 cbc = sample_color(currTex, uv + dv);\n vec4 cbr = sample_color(currTex, uv + dv + du);\n vec4 cmin = min(ctl, min(ctc, min(ctr, min(cml, min(cmc, min(cmr, min(cbl, min(cbc, cbr))))))));\n vec4 cmax = max(ctl, max(ctc, max(ctr, max(cml, max(cmc, max(cmr, max(cbl, max(cbc, cbr))))))));\n #if defined(MINMAX_3X3_ROUNDED) || defined(USE_YCOCG) || defined(USE_CLIPPING)\n vec4 cavg = (ctl + ctc + ctr + cml + cmc + cmr + cbl + cbc + cbr) / 9.0;\n #endif\n #ifdef MINMAX_3X3_ROUNDED\n vec4 cmin5 = min(ctc, min(cml, min(cmc, min(cmr, cbc))));\n vec4 cmax5 = max(ctc, max(cml, max(cmc, max(cmr, cbc))));\n vec4 cavg5 = (ctc + cml + cmc + cmr + cbc) / 5.0;\n cmin = 0.5 * (cmin + cmin5);\n cmax = 0.5 * (cmax + cmax5);\n cavg = 0.5 * (cavg + cavg5);\n #endif\n#elif defined(MINMAX_4TAP_VARYING)\n const float _SubpixelThreshold = 0.5;\n const float _GatherBase = 0.5;\n const float _GatherSubpixelMotion = 0.1666;\n vec2 texel_vel = ss_vel / depthTexelSize.xy;\n float texel_vel_mag = length(texel_vel) * vs_dist;\n float k_subpixel_motion = clamp(_SubpixelThreshold / (FLT_EPS + texel_vel_mag), 0.0, 1.0);\n float k_min_max_support = _GatherBase + _GatherSubpixelMotion * k_subpixel_motion;\n vec2 ss_offset01 = k_min_max_support * vec2(-texelSize.x, texelSize.y);\n vec2 ss_offset11 = k_min_max_support * vec2(texelSize.x, texelSize.y);\n vec4 c00 = sample_color(currTex, uv - ss_offset11);\n vec4 c10 = sample_color(currTex, uv - ss_offset01);\n vec4 c01 = sample_color(currTex, uv + ss_offset01);\n vec4 c11 = sample_color(currTex, uv + ss_offset11);\n vec4 cmin = min(c00, min(c10, min(c01, c11)));\n vec4 cmax = max(c00, max(c10, max(c01, c11)));\n #if defined(USE_YCOCG) || defined(USE_CLIPPING)\n vec4 cavg = (c00 + c10 + c01 + c11) / 4.0;\n #endif\n#endif\n#ifdef USE_YCOCG\n vec2 chroma_extent = vec2(0.25 * 0.5 * (cmax.r - cmin.r));\n vec2 chroma_center = texel0.gb;\n cmin.yz = chroma_center - chroma_extent;\n cmax.yz = chroma_center + chroma_extent;\n cavg.yz = chroma_center;\n#endif\n#ifdef USE_CLIPPING\n texel1 = clip_aabb(cmin.xyz, cmax.xyz, clamp(cavg, cmin, cmax), texel1);\n#else\n texel1 = clamp(texel1, cmin, cmax);\n#endif\n#ifdef USE_YCOCG\n float lum0 = texel0.r;\n float lum1 = texel1.r;\n#else\n float lum0 = dot(texel0.rgb, w);\n float lum1 = dot(texel1.rgb, w);\n#endif\n float unbiased_diff = abs(lum0 - lum1) / max(lum0, max(lum1, 0.2));\n float unbiased_weight = 1.0 - unbiased_diff;\n float unbiased_weight_sqr = unbiased_weight * unbiased_weight;\n float k_feedback = mix(feedbackMin, feedbackMax, unbiased_weight_sqr);\n return mix(texel0, texel1, k_feedback);\n}\nvoid main()\n{\n vec2 uv = v_Texcoord;\n if (still) {\n gl_FragColor = mix(texture2D(currTex, uv), texture2D(prevTex, uv), 0.9);\n return;\n }\n#ifdef USE_DILATION\n vec3 c_frag = find_closest_fragment_3x3(uv);\n vec4 velTexel = texture2D(velocityTex, c_frag.xy);\n float vs_dist = depth_resolve_linear(c_frag.z);\n#else\n vec4 velTexel = texture2D(velocityTex, uv);\n float depth = texture2D(depthTex, uv).r;\n float vs_dist = depth_resolve_linear(depth);\n#endif\n if (length(velTexel.rg - 0.5) > 0.5 || velTexel.a < 0.1) {\n gl_FragColor = texture2D(currTex, uv);\n return;\n }\n vec2 ss_vel = velTexel.rg - 0.5;\n vec4 color_temporal = temporal_reprojection(v_Texcoord, ss_vel, vs_dist);\n#ifdef USE_MOTION_BLUR\n #ifdef USE_MOTION_BLUR_NEIGHBORMAX\n ss_vel = motionScale * tex2D(_VelocityNeighborMax, v_Texcoord).xy;\n #else\n ss_vel = motionScale * ss_vel;\n #endif\n float vel_mag = length(ss_vel / texelSize);\n const float vel_trust_full = 2.0;\n const float vel_trust_none = 15.0;\n const float vel_trust_span = vel_trust_none - vel_trust_full;\n float trust = 1.0 - clamp(vel_mag - vel_trust_full, 0.0, vel_trust_span) / vel_trust_span;\n vec4 color_motion = sample_color_motion(currTex, v_Texcoord, ss_vel);\n gl_FragColor = resolve_color(mix(color_motion, color_temporal, trust));\n#else\n vec4 noise4 = PDsrand4(v_Texcoord + sinTime + 0.6959174) / 510.0;\n gl_FragColor = clamp(resolve_color(color_temporal) + noise4, vec4(0.0), vec4(1.0));\n#endif\n}\n@end\n";
