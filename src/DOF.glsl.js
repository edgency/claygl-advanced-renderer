export default "@export car.dof.coc\nuniform sampler2D depth;\nuniform float zNear = 0.1;\nuniform float zFar = 2000;\nuniform float focalDistance = 10;\nuniform float focalLength = 50;\nuniform float aperture = 5.6;\nuniform float maxCoc;\nuniform float _filmHeight = 0.024;\nvarying vec2 v_Texcoord;\n@import clay.util.encode_float\nvoid main()\n{\n float z = texture2D(depth, v_Texcoord).r * 2.0 - 1.0;\n float dist = 2.0 * zNear * zFar / (zFar + zNear - z * (zFar - zNear));\n float f = focalLength / 1000.0;\n float s1 = max(f, focalDistance);\n float coeff = f * f / (aperture * (s1 - f) * _filmHeight * 2.0);\n float coc = (dist - focalDistance) * coeff / max(dist, 1e-5);\n coc /= maxCoc;\n gl_FragColor = vec4(clamp(coc * 0.5 + 0.5, 0.0, 1.0), 0.0, 0.0, 1.0);\n}\n@end\n@export car.dof.composite\n#define DEBUG 0\nuniform sampler2D sharpTex;\nuniform sampler2D nearTex;\nuniform sampler2D farTex;\nuniform sampler2D cocTex;\nuniform float maxCoc;\nuniform float minCoc;\nvarying vec2 v_Texcoord;\n@import clay.util.rgbm\nvoid main()\n{\n float coc = texture2D(cocTex, v_Texcoord).r * 2.0 - 1.0;\n vec4 nearTexel = decodeHDR(texture2D(nearTex, v_Texcoord));\n vec4 farTexel = decodeHDR(texture2D(farTex, v_Texcoord));\n vec4 sharpTexel = decodeHDR(texture2D(sharpTex, v_Texcoord));\n float nfa = nearTexel.a;\n float ffa = smoothstep(0.0, 0.2, coc);\n gl_FragColor.rgb = mix(mix(sharpTexel.rgb, farTexel.rgb, ffa), nearTexel.rgb, nfa);\n gl_FragColor.a = max(max(sharpTexel.a, nearTexel.a), farTexel.a);\n}\n@end\n@export car.dof.separate\nuniform sampler2D mainTex;\nuniform sampler2D cocTex;\nvarying vec2 v_Texcoord;\n@import clay.util.rgbm\nvoid main()\n{\n vec4 color = decodeHDR(texture2D(mainTex, v_Texcoord));\n float coc = texture2D(cocTex, v_Texcoord).r * 2.0 - 1.0;\n#ifdef FARFIELD\n color *= step(0.0, coc);\n#else\n color *= step(0.0, -coc);\n#endif\n gl_FragColor = encodeHDR(color);\n}\n@end\n@export car.dof.maxCoc\nuniform sampler2D cocTex;\nuniform vec2 textureSize;\nvarying vec2 v_Texcoord;\nfloat tap(vec2 off) {\n return texture2D(cocTex, v_Texcoord + off).r * 2.0 - 1.0;\n}\nvoid main()\n{\n vec2 texelSize = 1.0 / textureSize;\n vec4 d = vec4(-1.0, -1.0, +1.0, +1.0) * texelSize.xyxy;\n float coc = tap(vec2(0.0));\n float lt = tap(d.xy);\n float rt = tap(d.zy);\n float lb = tap(d.xw);\n float rb = tap(d.zw);\n coc = abs(lt) > abs(coc) ? lt : coc;\n coc = abs(rt) > abs(coc) ? rt : coc;\n coc = abs(lb) > abs(coc) ? lb : coc;\n coc = abs(rb) > abs(coc) ? rb : coc;\n gl_FragColor = vec4(coc * 0.5 + 0.5, 0.0,0.0,1.0);\n}\n@end\n@export car.dof.blur\n#define KERNEL_SIZE 17\nconst vec2 kernel1Weight = vec2(0.411259,-0.548794);\nconst vec2 kernel2Weight = vec2(0.513282,4.561110);\nuniform vec4 kernel1[KERNEL_SIZE];\nuniform vec4 kernel2[KERNEL_SIZE];\n#ifdef FINAL_PASS\nuniform sampler2D rTex;\nuniform sampler2D gTex;\nuniform sampler2D bTex;\nuniform sampler2D aTex;\n#else\nuniform sampler2D mainTex;\n#endif\nuniform sampler2D cocTex;\nuniform sampler2D maxCocTex;\nuniform float maxCoc;\nuniform vec2 textureSize;\nvarying vec2 v_Texcoord;\nvec2 multComplex(vec2 p, vec2 q)\n{\n return vec2(p.x*q.x-p.y*q.y, p.x*q.y+p.y*q.x);\n}\n@import clay.util.rgbm\n@import clay.util.float\nvoid main()\n{\n float halfKernelSize = float(KERNEL_SIZE / 2);\n vec2 texelSize = 1.0 / textureSize;\n float weight = 0.0;\n#ifdef FARFIELD\n float coc0 = texture2D(cocTex, v_Texcoord).r * 2.0 - 1.0;\n if (coc0 <= 0.0) {\n discard;\n }\n#else\n float maxCoc0 = texture2D(maxCocTex, v_Texcoord).r * 2.0 - 1.0;\n float coc0 = texture2D(cocTex, v_Texcoord).r * 2.0 - 1.0;\n#endif\n coc0 *= maxCoc;\n#ifdef FINAL_PASS\n vec4 valR = vec4(0.0);\n vec4 valG = vec4(0.0);\n vec4 valB = vec4(0.0);\n vec4 valA = vec4(0.0);\n vec2 offset = vec2(0.0, coc0 / halfKernelSize);\n#else\n vec4 val = vec4(0.0);\n vec2 offset = vec2(texelSize.x / texelSize.y * coc0 / halfKernelSize, 0.0);\n#endif\n float margin = texelSize.y;\n for (int i = 0; i < KERNEL_SIZE; i++) {\n vec2 duv = (float(i) - halfKernelSize) * offset;\n vec2 uv = clamp(v_Texcoord + duv, vec2(0.0), vec2(1.0));\n float coc = texture2D(cocTex, uv).r * 2.0 - 1.0;\n coc *= maxCoc;\n float w = 1.0;\n#ifdef FARFIELD\n w = step(0.0, coc);\n#endif\n weight += w;\n vec4 c0c1 = vec4(kernel1[i].xy, kernel2[i].xy);\n#ifdef FINAL_PASS\n vec4 rTexel = texture2D(rTex, uv) * w;\n vec4 gTexel = texture2D(gTex, uv) * w;\n vec4 bTexel = texture2D(bTex, uv) * w;\n vec4 aTexel = texture2D(aTex, uv) * w;\n valR.xy += multComplex(rTexel.xy,c0c1.xy);\n valR.zw += multComplex(rTexel.zw,c0c1.zw);\n valG.xy += multComplex(gTexel.xy,c0c1.xy);\n valG.zw += multComplex(gTexel.zw,c0c1.zw);\n valB.xy += multComplex(bTexel.xy,c0c1.xy);\n valB.zw += multComplex(bTexel.zw,c0c1.zw);\n valA.xy += multComplex(aTexel.xy,c0c1.xy);\n valA.zw += multComplex(aTexel.zw,c0c1.zw);\n#else\n vec4 color = texture2D(mainTex, uv);\n float tmp;\n #if defined(R_PASS)\n tmp = color.r;\n #elif defined(G_PASS)\n tmp = color.g;\n #elif defined(B_PASS)\n tmp = color.b;\n #elif defined(A_PASS)\n tmp = color.a;\n #endif\n val += tmp * c0c1 * w;\n#endif\n }\n weight /= float(KERNEL_SIZE);\n#ifdef FINAL_PASS\n valR /= weight;\n valG /= weight;\n valB /= weight;\n valA /= weight;\n float r = dot(valR.xy,kernel1Weight)+dot(valR.zw,kernel2Weight);\n float g = dot(valG.xy,kernel1Weight)+dot(valG.zw,kernel2Weight);\n float b = dot(valB.xy,kernel1Weight)+dot(valB.zw,kernel2Weight);\n float a = dot(valA.xy,kernel1Weight)+dot(valA.zw,kernel2Weight);\n gl_FragColor = vec4(r, g, b, a);\n#else\n val /= weight;\n gl_FragColor = val;\n#endif\n}\n@end";
