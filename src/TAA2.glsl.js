export default "@export car.taa\n#define SHADER_NAME TAA2\nuniform sampler2D prevTex;\nuniform sampler2D currTex;\nuniform sampler2D velocityTex;\nuniform vec2 texelSize;\nuniform vec2 velocityTexelSize;\nuniform vec2 jitterOffset;\nuniform float hysteresis = 0.9;\nuniform bool still;\nvarying vec2 v_Texcoord;\nvec4 slideTowardsAABB(in vec4 oldColor, in vec4 newColor, in vec4 minimum, in vec4 maximum, in float maxVel) {\n if (all(greaterThanEqual(oldColor, minimum)) && all(lessThanEqual(oldColor, maximum))) {\n return oldColor;\n }\n else {\n float ghost = 0.4; return mix(newColor, oldColor, ghost);\n }\n}\nvoid main () {\n if (still) {\n gl_FragColor = mix(texture2D(currTex, v_Texcoord), texture2D(prevTex, v_Texcoord), 0.9);\n return;\n }\n float sharpen = 0.01 * pow(hysteresis, 3.0);\n vec4 source = texture2D(currTex, v_Texcoord);\n vec4 motionTexel = texture2D(velocityTex, v_Texcoord - jitterOffset);\n vec2 motion = motionTexel.rg - 0.5;\n if (length(motion) > 0.5 || motionTexel.a < 0.1) {\n gl_FragColor = source;\n return;\n }\n vec4 localMin = source, localMax = source;\n float maxVel = dot(motion, motion);\n for (int y = -1; y <= +1; ++y) {\n for (int x = -1; x <= +1; ++x) {\n vec2 off = vec2(float(x), float(y));\n vec4 c = texture2D(currTex, v_Texcoord + off * texelSize);\n localMin = min(localMin, c);\n localMax = max(localMax, c);\n vec4 mTexel = texture2D(velocityTex, v_Texcoord + off * velocityTexelSize);\n vec2 m = mTexel.xy - 0.5;\n if (length(m) > 0.5 || mTexel.a < 0.1) {\n continue;\n }\n maxVel = max(dot(m, m), maxVel);\n }\n }\n vec4 history = texture2D(prevTex, v_Texcoord - motion);\n if (sharpen > 0.0) {\n history =\n history * (1.0 + sharpen) -\n (texture2D(prevTex, v_Texcoord + texelSize) +\n texture2D(prevTex, v_Texcoord + vec2(-1.0,1.0) * texelSize) +\n texture2D(prevTex, v_Texcoord + vec2(1.0,-1.0) * texelSize) +\n texture2D(prevTex, v_Texcoord + -texelSize)) * (sharpen * 0.25);\n }\n history = slideTowardsAABB(history, source, localMin, localMax, maxVel);\n gl_FragColor = mix(source, history, hysteresis * clamp(1.0 - length(motion) * 0.2, 0.85, 1.0));\n}\n@end";
