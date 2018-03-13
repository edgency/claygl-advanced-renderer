(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory(require('claygl')) :
	typeof define === 'function' && define.amd ? define(['claygl'], factory) :
	(global.ClayAdvancedRenderer = factory(global.clay));
}(this, (function (claygl) { 'use strict';

// Generate halton sequence
// https://en.wikipedia.org/wiki/Halton_sequence
function halton(index, base) {

    var result = 0;
    var f = 1 / base;
    var i = index;
    while (i > 0) {
        result = result + f * (i % base);
        i = Math.floor(i / base);
        f = f / base;
    }
    return result;
}

var SSAOGLSLCode = "@export car.ssao.estimate\n#define SHADER_NAME SSAO\nuniform sampler2D depthTex;\nuniform sampler2D normalTex;\nuniform sampler2D noiseTex;\nuniform vec2 depthTexSize;\nuniform vec2 noiseTexSize;\nuniform mat4 projection;\nuniform mat4 projectionInv;\nuniform mat4 viewInverseTranspose;\nuniform vec3 kernel[KERNEL_SIZE];\nuniform float radius : 1;\nuniform float power : 1;\nuniform float bias: 0.01;\nuniform float intensity: 1.0;\nvarying vec2 v_Texcoord;\nfloat ssaoEstimator(in vec3 originPos, in vec3 N, in mat3 kernelBasis) {\n float occlusion = 0.0;\n for (int i = 0; i < KERNEL_SIZE; i++) {\n vec3 samplePos = kernel[i];\n#ifdef NORMALTEX_ENABLED\n samplePos = kernelBasis * samplePos;\n#endif\n samplePos = samplePos * radius + originPos;\n vec4 texCoord = projection * vec4(samplePos, 1.0);\n texCoord.xy /= texCoord.w;\n texCoord.xy = texCoord.xy * 0.5 + 0.5;\n vec4 depthTexel = texture2D(depthTex, texCoord.xy);\n float z = depthTexel.r * 2.0 - 1.0;\n#ifdef ALCHEMY\n vec4 projectedPos = vec4(texCoord.xy * 2.0 - 1.0, z, 1.0);\n vec4 p4 = projectionInv * projectedPos;\n p4.xyz /= p4.w;\n vec3 cDir = p4.xyz - originPos;\n float vv = dot(cDir, cDir);\n float vn = dot(cDir, N);\n float radius2 = radius * radius;\n vn = max(vn + p4.z * bias, 0.0);\n float f = max(radius2 - vv, 0.0) / radius2;\n occlusion += f * f * f * max(vn / (0.01 + vv), 0.0);\n#else\n if (projection[3][3] == 0.0) {\n z = projection[3][2] / (z * projection[2][3] - projection[2][2]);\n }\n else {\n z = (z - projection[3][2]) / projection[2][2];\n }\n float factor = step(samplePos.z, z - bias);\n float rangeCheck = smoothstep(0.0, 1.0, radius / abs(originPos.z - z));\n occlusion += rangeCheck * factor;\n#endif\n }\n#ifdef NORMALTEX_ENABLED\n occlusion = 1.0 - occlusion / float(KERNEL_SIZE);\n#else\n occlusion = 1.0 - clamp((occlusion / float(KERNEL_SIZE) - 0.6) * 2.5, 0.0, 1.0);\n#endif\n return pow(occlusion, power);\n}\nvoid main()\n{\n vec4 depthTexel = texture2D(depthTex, v_Texcoord);\n#ifdef NORMALTEX_ENABLED\n vec4 tex = texture2D(normalTex, v_Texcoord);\n if (dot(tex.rgb, tex.rgb) == 0.0) {\n gl_FragColor = vec4(1.0);\n return;\n }\n vec3 N = tex.rgb * 2.0 - 1.0;\n N = (viewInverseTranspose * vec4(N, 0.0)).xyz;\n vec2 noiseTexCoord = depthTexSize / vec2(noiseTexSize) * v_Texcoord;\n vec3 rvec = texture2D(noiseTex, noiseTexCoord).rgb * 2.0 - 1.0;\n vec3 T = normalize(rvec - N * dot(rvec, N));\n vec3 BT = normalize(cross(N, T));\n mat3 kernelBasis = mat3(T, BT, N);\n#else\n if (depthTexel.r > 0.99999) {\n gl_FragColor = vec4(1.0);\n return;\n }\n mat3 kernelBasis;\n#endif\n float z = depthTexel.r * 2.0 - 1.0;\n vec4 projectedPos = vec4(v_Texcoord * 2.0 - 1.0, z, 1.0);\n vec4 p4 = projectionInv * projectedPos;\n vec3 position = p4.xyz / p4.w;\n float ao = ssaoEstimator(position, N, kernelBasis);\n ao = clamp(1.0 - (1.0 - ao) * intensity, 0.0, 1.0);\n gl_FragColor = vec4(vec3(ao), 1.0);\n}\n@end\n@export car.ssao.blur\n#define SHADER_NAME SSAO_BLUR\nuniform sampler2D ssaoTexture;\n#ifdef NORMALTEX_ENABLED\nuniform sampler2D normalTex;\n#endif\nvarying vec2 v_Texcoord;\nuniform vec2 textureSize;\nuniform float blurSize : 1.0;\nuniform int direction: 0.0;\n#ifdef DEPTHTEX_ENABLED\nuniform sampler2D depthTex;\nuniform mat4 projection;\nuniform float depthRange : 0.05;\nfloat getLinearDepth(vec2 coord)\n{\n float depth = texture2D(depthTex, coord).r * 2.0 - 1.0;\n return projection[3][2] / (depth * projection[2][3] - projection[2][2]);\n}\n#endif\nvoid main()\n{\n float kernel[5];\n kernel[0] = 0.122581;\n kernel[1] = 0.233062;\n kernel[2] = 0.288713;\n kernel[3] = 0.233062;\n kernel[4] = 0.122581;\n vec2 off = vec2(0.0);\n if (direction == 0) {\n off[0] = blurSize / textureSize.x;\n }\n else {\n off[1] = blurSize / textureSize.y;\n }\n vec2 coord = v_Texcoord;\n float sum = 0.0;\n float weightAll = 0.0;\n#ifdef NORMALTEX_ENABLED\n vec3 centerNormal = texture2D(normalTex, v_Texcoord).rgb * 2.0 - 1.0;\n#endif\n#if defined(DEPTHTEX_ENABLED)\n float centerDepth = getLinearDepth(v_Texcoord);\n#endif\n for (int i = 0; i < 5; i++) {\n vec2 coord = clamp(v_Texcoord + vec2(float(i) - 2.0) * off, vec2(0.0), vec2(1.0));\n float w = kernel[i];\n#ifdef NORMALTEX_ENABLED\n vec3 normal = texture2D(normalTex, coord).rgb * 2.0 - 1.0;\n w *= clamp(dot(normal, centerNormal), 0.0, 1.0);\n#endif\n#ifdef DEPTHTEX_ENABLED\n float d = getLinearDepth(coord);\n w *= (1.0 - smoothstep(abs(centerDepth - d) / depthRange, 0.0, 1.0));\n#endif\n weightAll += w;\n sum += texture2D(ssaoTexture, coord).r * w;\n }\n gl_FragColor = vec4(vec3(sum / weightAll), 1.0);\n}\n@end\n";

var Pass = claygl.compositor.Pass;
claygl.Shader.import(SSAOGLSLCode);

function generateNoiseData(size) {
    var data = new Uint8Array(size * size * 4);
    var n = 0;
    var v3 = new claygl.Vector3();

    for (var i = 0; i < size; i++) {
        for (var j = 0; j < size; j++) {
            v3.set(Math.random() * 2 - 1, Math.random() * 2 - 1, 0).normalize();
            data[n++] = (v3.x * 0.5 + 0.5) * 255;
            data[n++] = (v3.y * 0.5 + 0.5) * 255;
            data[n++] = 0;
            data[n++] = 255;
        }
    }
    return data;
}

function generateNoiseTexture(size) {
    return new claygl.Texture2D({
        pixels: generateNoiseData(size),
        wrapS: claygl.Texture.REPEAT,
        wrapT: claygl.Texture.REPEAT,
        width: size,
        height: size
    });
}

function generateKernel(size, offset, hemisphere) {
    var kernel = new Float32Array(size * 3);
    offset = offset || 0;
    for (var i = 0; i < size; i++) {
        var phi = halton(i + offset, 2) * (hemisphere ? 1 : 2) * Math.PI;
        var theta = halton(i + offset, 3) * Math.PI;
        var r = Math.random();
        var x = Math.cos(phi) * Math.sin(theta) * r;
        var y = Math.cos(theta) * r;
        var z = Math.sin(phi) * Math.sin(theta) * r;

        kernel[i * 3] = x;
        kernel[i * 3 + 1] = y;
        kernel[i * 3 + 2] = z;
    }
    return kernel;
}

function SSAOPass(opt) {
    opt = opt || {};

    this._ssaoPass = new Pass({
        fragment: claygl.Shader.source('car.ssao.estimate')
    });
    this._blendPass = new Pass({
        fragment: claygl.Shader.source('car.temporalBlend')
    });
    this._blurPass = new Pass({
        fragment: claygl.Shader.source('car.ssao.blur')
    });
    this._framebuffer = new claygl.FrameBuffer();

    this._ssaoTexture = new claygl.Texture2D();

    this._prevTexture = new claygl.Texture2D();
    this._currTexture = new claygl.Texture2D();

    this._blurTexture = new claygl.Texture2D();

    this._depthTex = opt.depthTexture;
    this._normalTex = opt.normalTexture;
    this._velocityTex = opt.velocityTexture;

    this.setNoiseSize(4);
    this.setKernelSize(opt.kernelSize || 12);
    if (opt.radius != null) {
        this.setParameter('radius', opt.radius);
    }
    if (opt.power != null) {
        this.setParameter('power', opt.power);
    }

    if (!this._normalTex) {
        this._ssaoPass.material.disableTexture('normalTex');
        this._blurPass.material.disableTexture('normalTex');
    }
    if (!this._depthTex) {
        this._blurPass.material.disableTexture('depthTex');
    }

    this._blurPass.material.setUniform('normalTex', this._normalTex);
    this._blurPass.material.setUniform('depthTex', this._depthTex);
}

SSAOPass.prototype.setDepthTexture = function (depthTex) {
    this._depthTex = depthTex;
};

SSAOPass.prototype.setNormalTexture = function (normalTex) {
    this._normalTex = normalTex;
    this._ssaoPass.material[normalTex ? 'enableTexture' : 'disableTexture']('normalTex');
    // Switch between hemisphere and shere kernel.
    this.setKernelSize(this._kernelSize);
};

SSAOPass.prototype.update = function (renderer, camera$$1, frame) {

    var width = renderer.getWidth();
    var height = renderer.getHeight();

    var ssaoPass = this._ssaoPass;
    var blurPass = this._blurPass;
    var blendPass = this._blendPass;

    ssaoPass.setUniform('kernel', this._kernels[frame % this._kernels.length]);
    ssaoPass.setUniform('depthTex', this._depthTex);
    if (this._normalTex != null) {
        ssaoPass.setUniform('normalTex', this._normalTex);
    }
    ssaoPass.setUniform('depthTexSize', [this._depthTex.width, this._depthTex.height]);

    var viewInverseTranspose = new claygl.Matrix4();
    claygl.Matrix4.transpose(viewInverseTranspose, camera$$1.worldTransform);

    ssaoPass.setUniform('projection', camera$$1.projectionMatrix.array);
    ssaoPass.setUniform('projectionInv', camera$$1.invProjectionMatrix.array);
    ssaoPass.setUniform('viewInverseTranspose', viewInverseTranspose.array);

    var ssaoTexture = this._ssaoTexture;
    var blurTexture = this._blurTexture;

    var prevTexture = this._prevTexture;
    var currTexture = this._currTexture;

    ssaoTexture.width = width;
    ssaoTexture.height = height;
    blurTexture.width = width;
    blurTexture.height = height;
    prevTexture.width = width;
    prevTexture.height = height;
    currTexture.width = width;
    currTexture.height = height;

    this._framebuffer.attach(ssaoTexture);
    this._framebuffer.bind(renderer);
    renderer.gl.clearColor(1, 1, 1, 1);
    renderer.gl.clear(renderer.gl.COLOR_BUFFER_BIT);
    ssaoPass.render(renderer);

    // this._framebuffer.attach(currTexture);
    // blendPass.setUniform('prevTex', prevTexture);
    // blendPass.setUniform('currTex', ssaoTexture);
    // blendPass.setUniform('velocityTex', this._velocityTex);
    // blendPass.render(renderer);

    blurPass.setUniform('textureSize', [width, height]);
    blurPass.setUniform('projection', camera$$1.projectionMatrix.array);
    this._framebuffer.attach(blurTexture);
    blurPass.setUniform('direction', 0);
    blurPass.setUniform('ssaoTexture', ssaoTexture);
    blurPass.render(renderer);

    this._framebuffer.attach(ssaoTexture);
    blurPass.setUniform('direction', 1);
    blurPass.setUniform('ssaoTexture', blurTexture);
    blurPass.render(renderer);

    this._framebuffer.unbind(renderer);

    // Restore clear
    var clearColor = renderer.clearColor;
    renderer.gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);

    // Swap texture

    // var tmp = this._prevTexture;
    // this._prevTexture = this._currTexture;
    // this._currTexture = tmp;
};

SSAOPass.prototype.getTargetTexture = function () {
    return this._ssaoTexture;
};

SSAOPass.prototype.setParameter = function (name, val) {
    if (name === 'noiseTexSize') {
        this.setNoiseSize(val);
    }
    else if (name === 'kernelSize') {
        this.setKernelSize(val);
    }
    else if (name === 'intensity') {
        this._ssaoPass.material.set('intensity', val);
    }
    else {
        this._ssaoPass.setUniform(name, val);
    }
};

SSAOPass.prototype.setKernelSize = function (size) {
    this._kernelSize = size;
    this._ssaoPass.material.define('fragment', 'KERNEL_SIZE', size);
    this._kernels = this._kernels || [];
    for (var i = 0; i < 30; i++) {
        this._kernels[i] = generateKernel(size, i * size, !!this._normalTex);
    }
};

SSAOPass.prototype.setNoiseSize = function (size) {
    var texture = this._ssaoPass.getUniform('noiseTex');
    if (!texture) {
        texture = generateNoiseTexture(size);
        this._ssaoPass.setUniform('noiseTex', generateNoiseTexture(size));
    }
    else {
        texture.data = generateNoiseData(size);
        texture.width = texture.height = size;
        texture.dirty();
    }

    this._ssaoPass.setUniform('noiseTexSize', [size, size]);
};

SSAOPass.prototype.dispose = function (renderer) {
    this._blurTexture.dispose(renderer);
    this._ssaoTexture.dispose(renderer);
};

SSAOPass.prototype.isFinished = function (frame) {
    return frame > 30;
};

var SSRGLSLCode = "@export car.ssr.main\n#define SHADER_NAME SSR\n#define MAX_ITERATION 20;\n#define SAMPLE_PER_FRAME 5;\n#define TOTAL_SAMPLES 128;\nuniform sampler2D sourceTexture;\nuniform sampler2D gBufferTexture1;\nuniform sampler2D gBufferTexture2;\nuniform sampler2D gBufferTexture3;\nuniform samplerCube specularCubemap;\nuniform sampler2D brdfLookup;\nuniform float specularIntensity: 1;\nuniform mat4 projection;\nuniform mat4 projectionInv;\nuniform mat4 toViewSpace;\nuniform mat4 toWorldSpace;\nuniform float maxRayDistance: 200;\nuniform float pixelStride: 16;\nuniform float pixelStrideZCutoff: 50;\nuniform float screenEdgeFadeStart: 0.9;\nuniform float eyeFadeStart : 0.2;uniform float eyeFadeEnd: 0.8;\nuniform float minGlossiness: 0.2;uniform float zThicknessThreshold: 1;\nuniform float nearZ;\nuniform vec2 viewportSize : VIEWPORT_SIZE;\nuniform float jitterOffset: 0;\nvarying vec2 v_Texcoord;\n#ifdef DEPTH_DECODE\n@import clay.util.decode_float\n#endif\n#ifdef PHYSICALLY_CORRECT\nuniform sampler2D normalDistribution;\nuniform float sampleOffset: 0;\nuniform vec2 normalDistributionSize;\nvec3 transformNormal(vec3 H, vec3 N) {\n vec3 upVector = N.y > 0.999 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);\n vec3 tangentX = normalize(cross(N, upVector));\n vec3 tangentZ = cross(N, tangentX);\n return normalize(tangentX * H.x + N * H.y + tangentZ * H.z);\n}\nvec3 importanceSampleNormalGGX(float i, float roughness, vec3 N) {\n float p = fract((i + sampleOffset) / float(TOTAL_SAMPLES));\n vec3 H = texture2D(normalDistribution,vec2(roughness, p)).rgb;\n return transformNormal(H, N);\n}\nfloat G_Smith(float g, float ndv, float ndl) {\n float roughness = 1.0 - g;\n float k = roughness * roughness / 2.0;\n float G1V = ndv / (ndv * (1.0 - k) + k);\n float G1L = ndl / (ndl * (1.0 - k) + k);\n return G1L * G1V;\n}\nvec3 F_Schlick(float ndv, vec3 spec) {\n return spec + (1.0 - spec) * pow(1.0 - ndv, 5.0);\n}\n#endif\nfloat fetchDepth(sampler2D depthTexture, vec2 uv)\n{\n vec4 depthTexel = texture2D(depthTexture, uv);\n return depthTexel.r * 2.0 - 1.0;\n}\nfloat linearDepth(float depth)\n{\n if (projection[3][3] == 0.0) {\n return projection[3][2] / (depth * projection[2][3] - projection[2][2]);\n }\n else {\n return (depth - projection[3][2]) / projection[2][2];\n }\n}\nbool rayIntersectDepth(float rayZNear, float rayZFar, vec2 hitPixel)\n{\n if (rayZFar > rayZNear)\n {\n float t = rayZFar; rayZFar = rayZNear; rayZNear = t;\n }\n float cameraZ = linearDepth(fetchDepth(gBufferTexture2, hitPixel));\n return rayZFar <= cameraZ && rayZNear >= cameraZ - zThicknessThreshold;\n}\nbool traceScreenSpaceRay(\n vec3 rayOrigin, vec3 rayDir, float jitter,\n out vec2 hitPixel, out vec3 hitPoint, out float iterationCount\n)\n{\n float rayLength = ((rayOrigin.z + rayDir.z * maxRayDistance) > -nearZ)\n ? (-nearZ - rayOrigin.z) / rayDir.z : maxRayDistance;\n vec3 rayEnd = rayOrigin + rayDir * rayLength;\n vec4 H0 = projection * vec4(rayOrigin, 1.0);\n vec4 H1 = projection * vec4(rayEnd, 1.0);\n float k0 = 1.0 / H0.w, k1 = 1.0 / H1.w;\n vec3 Q0 = rayOrigin * k0, Q1 = rayEnd * k1;\n vec2 P0 = (H0.xy * k0 * 0.5 + 0.5) * viewportSize;\n vec2 P1 = (H1.xy * k1 * 0.5 + 0.5) * viewportSize;\n P1 += dot(P1 - P0, P1 - P0) < 0.0001 ? 0.01 : 0.0;\n vec2 delta = P1 - P0;\n bool permute = false;\n if (abs(delta.x) < abs(delta.y)) {\n permute = true;\n delta = delta.yx;\n P0 = P0.yx;\n P1 = P1.yx;\n }\n float stepDir = sign(delta.x);\n float invdx = stepDir / delta.x;\n vec3 dQ = (Q1 - Q0) * invdx;\n float dk = (k1 - k0) * invdx;\n vec2 dP = vec2(stepDir, delta.y * invdx);\n float strideScaler = 1.0 - min(1.0, -rayOrigin.z / pixelStrideZCutoff);\n float pixStride = 1.0 + strideScaler * pixelStride;\n dP *= pixStride; dQ *= pixStride; dk *= pixStride;\n vec4 pqk = vec4(P0, Q0.z, k0);\n vec4 dPQK = vec4(dP, dQ.z, dk);\n pqk += dPQK * jitter;\n float rayZFar = (dPQK.z * 0.5 + pqk.z) / (dPQK.w * 0.5 + pqk.w);\n float rayZNear;\n bool intersect = false;\n vec2 texelSize = 1.0 / viewportSize;\n iterationCount = 0.0;\n for (int i = 0; i < MAX_ITERATION; i++)\n {\n pqk += dPQK;\n rayZNear = rayZFar;\n rayZFar = (dPQK.z * 0.5 + pqk.z) / (dPQK.w * 0.5 + pqk.w);\n hitPixel = permute ? pqk.yx : pqk.xy;\n hitPixel *= texelSize;\n intersect = rayIntersectDepth(rayZNear, rayZFar, hitPixel);\n iterationCount += 1.0;\n dPQK *= 1.2;\n if (intersect) {\n break;\n }\n }\n Q0.xy += dQ.xy * iterationCount;\n Q0.z = pqk.z;\n hitPoint = Q0 / pqk.w;\n return intersect;\n}\nfloat calculateAlpha(\n float iterationCount, float reflectivity,\n vec2 hitPixel, vec3 hitPoint, float dist, vec3 rayDir\n)\n{\n float alpha = clamp(reflectivity, 0.0, 1.0);\n alpha *= 1.0 - (iterationCount / float(MAX_ITERATION));\n vec2 hitPixelNDC = hitPixel * 2.0 - 1.0;\n float maxDimension = min(1.0, max(abs(hitPixelNDC.x), abs(hitPixelNDC.y)));\n alpha *= 1.0 - max(0.0, maxDimension - screenEdgeFadeStart) / (1.0 - screenEdgeFadeStart);\n float _eyeFadeStart = eyeFadeStart;\n float _eyeFadeEnd = eyeFadeEnd;\n if (_eyeFadeStart > _eyeFadeEnd) {\n float tmp = _eyeFadeEnd;\n _eyeFadeEnd = _eyeFadeStart;\n _eyeFadeStart = tmp;\n }\n float eyeDir = clamp(rayDir.z, _eyeFadeStart, _eyeFadeEnd);\n alpha *= 1.0 - (eyeDir - _eyeFadeStart) / (_eyeFadeEnd - _eyeFadeStart);\n alpha *= 1.0 - clamp(dist / maxRayDistance, 0.0, 1.0);\n return alpha;\n}\n@import clay.util.rand\n@import clay.util.rgbm\nvoid main()\n{\n vec4 normalAndGloss = texture2D(gBufferTexture1, v_Texcoord);\n if (dot(normalAndGloss.rgb, vec3(1.0)) == 0.0) {\n discard;\n }\n float g = normalAndGloss.a;\n#if !defined(PHYSICALLY_CORRECT)\n if (g <= minGlossiness) {\n discard;\n }\n#endif\n float reflectivity = (g - minGlossiness) / (1.0 - minGlossiness);\n vec3 N = normalize(normalAndGloss.rgb * 2.0 - 1.0);\n N = normalize((toViewSpace * vec4(N, 0.0)).xyz);\n vec4 projectedPos = vec4(v_Texcoord * 2.0 - 1.0, fetchDepth(gBufferTexture2, v_Texcoord), 1.0);\n vec4 pos = projectionInv * projectedPos;\n vec3 rayOrigin = pos.xyz / pos.w;\n vec3 V = -normalize(rayOrigin);\n float ndv = clamp(dot(N, V), 0.0, 1.0);\n float iterationCount;\n float jitter = rand(fract(v_Texcoord + jitterOffset));\n vec4 albedoMetalness = texture2D(gBufferTexture3, v_Texcoord);\n vec3 albedo = albedoMetalness.rgb;\n float m = albedoMetalness.a;\n vec3 diffuseColor = albedo * (1.0 - m);\n vec3 spec = mix(vec3(0.04), albedo, m);\n#ifdef PHYSICALLY_CORRECT\n vec4 color = vec4(vec3(0.0), 1.0);\n float jitter2 = rand(fract(v_Texcoord)) * float(TOTAL_SAMPLES);\n for (int i = 0; i < SAMPLE_PER_FRAME; i++) {\n vec3 H = importanceSampleNormalGGX(float(i) + jitter2, 1.0 - g, N);\n vec3 rayDir = normalize(reflect(-V, H));\n#else\n vec3 rayDir = normalize(reflect(-V, N));\n#endif\n vec2 hitPixel;\n vec3 hitPoint;\n bool intersect = traceScreenSpaceRay(rayOrigin, rayDir, jitter, hitPixel, hitPoint, iterationCount);\n float dist = distance(rayOrigin, hitPoint);\n vec3 hitNormal = texture2D(gBufferTexture1, hitPixel).rgb * 2.0 - 1.0;\n hitNormal = normalize((toViewSpace * vec4(hitNormal, 0.0)).xyz);\n#ifdef PHYSICALLY_CORRECT\n float ndl = clamp(dot(N, rayDir), 0.0, 1.0);\n float vdh = clamp(dot(V, H), 0.0, 1.0);\n float ndh = clamp(dot(N, H), 0.0, 1.0);\n vec3 litTexel = vec3(0.0);\n if (dot(hitNormal, rayDir) < 0.0 && intersect) {\n litTexel = texture2D(sourceTexture, hitPixel).rgb;\n litTexel *= pow(clamp(1.0 - dist / 200.0, 0.0, 1.0), 3.0);\n }\n else {\n#ifdef SPECULARCUBEMAP_ENABLED\n vec3 rayDirW = normalize(toWorldSpace * vec4(rayDir, 0.0)).rgb;\n litTexel = RGBMDecode(textureCubeLodEXT(specularCubemap, rayDirW, 0.0), 8.12).rgb * specularIntensity;\n#endif\n }\n color.rgb += ndl * litTexel * (\n F_Schlick(ndl, spec) * G_Smith(g, ndv, ndl) * vdh / (ndh * ndv + 0.001)\n );\n }\n color.rgb /= float(SAMPLE_PER_FRAME);\n#else\n#if !defined(SPECULARCUBEMAP_ENABLED)\n if (dot(hitNormal, rayDir) >= 0.0) {\n discard;\n }\n if (!intersect) {\n discard;\n }\n#endif\n float alpha = clamp(calculateAlpha(iterationCount, reflectivity, hitPixel, hitPoint, dist, rayDir), 0.0, 1.0);\n vec4 color = texture2D(sourceTexture, hitPixel);\n color.rgb *= alpha;\n#ifdef SPECULARCUBEMAP_ENABLED\n vec3 rayDirW = normalize(toWorldSpace * vec4(rayDir, 0.0)).rgb;\n alpha = alpha * (intersect ? 1.0 : 0.0);\n float bias = (1.0 - g) * 5.0;\n vec2 brdfParam2 = texture2D(brdfLookup, vec2(1.0 - g, ndv)).xy;\n color.rgb += (1.0 - alpha)\n * RGBMDecode(textureCubeLodEXT(specularCubemap, rayDirW, bias), 8.12).rgb\n * (spec * brdfParam2.x + brdfParam2.y)\n * specularIntensity;\n#endif\n#endif\n gl_FragColor = encodeHDR(color);\n}\n@end\n@export car.ssr.blur\nuniform sampler2D texture;\nuniform sampler2D gBufferTexture1;\nuniform sampler2D gBufferTexture2;\nuniform mat4 projection;\nuniform float depthRange : 0.05;\nvarying vec2 v_Texcoord;\nuniform vec2 textureSize;\nuniform float blurSize : 1.0;\n#ifdef BLEND\n #ifdef SSAOTEX_ENABLED\nuniform sampler2D ssaoTex;\n #endif\nuniform sampler2D sourceTexture;\n#endif\nfloat getLinearDepth(vec2 coord)\n{\n float depth = texture2D(gBufferTexture2, coord).r * 2.0 - 1.0;\n return projection[3][2] / (depth * projection[2][3] - projection[2][2]);\n}\n@import clay.util.rgbm\nvoid main()\n{\n @import clay.compositor.kernel.gaussian_9\n vec4 centerNTexel = texture2D(gBufferTexture1, v_Texcoord);\n float g = centerNTexel.a;\n float maxBlurSize = clamp(1.0 - g, 0.0, 1.0) * blurSize;\n#ifdef VERTICAL\n vec2 off = vec2(0.0, maxBlurSize / textureSize.y);\n#else\n vec2 off = vec2(maxBlurSize / textureSize.x, 0.0);\n#endif\n vec2 coord = v_Texcoord;\n vec4 sum = vec4(0.0);\n float weightAll = 0.0;\n vec3 cN = centerNTexel.rgb * 2.0 - 1.0;\n float cD = getLinearDepth(v_Texcoord);\n for (int i = 0; i < 9; i++) {\n vec2 coord = clamp((float(i) - 4.0) * off + v_Texcoord, vec2(0.0), vec2(1.0));\n float w = gaussianKernel[i]\n * clamp(dot(cN, texture2D(gBufferTexture1, coord).rgb * 2.0 - 1.0), 0.0, 1.0);\n float d = getLinearDepth(coord);\n w *= (1.0 - smoothstep(abs(cD - d) / depthRange, 0.0, 1.0));\n weightAll += w;\n sum += decodeHDR(texture2D(texture, coord)) * w;\n }\n#ifdef BLEND\n float aoFactor = 1.0;\n #ifdef SSAOTEX_ENABLED\n aoFactor = texture2D(ssaoTex, v_Texcoord).r;\n #endif\n gl_FragColor = encodeHDR(\n sum / weightAll * aoFactor + decodeHDR(texture2D(sourceTexture, v_Texcoord))\n );\n#else\n gl_FragColor = encodeHDR(sum / weightAll);\n#endif\n}\n@end";

var Pass$1 = claygl.compositor.Pass;
var cubemapUtil = claygl.util.cubemap;

// import halton from './halton';

claygl.Shader.import(SSRGLSLCode);

// function generateNormals(size, offset, hemisphere) {
//     var kernel = new Float32Array(size * 3);
//     offset = offset || 0;
//     for (var i = 0; i < size; i++) {
//         var phi = halton(i + offset, 2) * (hemisphere ? 1 : 2) * Math.PI / 2;
//         var theta = halton(i + offset, 3) * 2 * Math.PI;
//         var x = Math.cos(theta) * Math.sin(phi);
//         var y = Math.sin(theta) * Math.sin(phi);
//         var z = Math.cos(phi);
//         kernel[i * 3] = x;
//         kernel[i * 3 + 1] = y;
//         kernel[i * 3 + 2] = z;
//     }
//     return kernel;
// }

function SSRPass(opt) {
    opt = opt || {};

    this._ssrPass = new Pass$1({
        fragment: claygl.Shader.source('car.ssr.main'),
        clearColor: [0, 0, 0, 0]
    });
    this._blurPass1 = new Pass$1({
        fragment: claygl.Shader.source('car.ssr.blur'),
        clearColor: [0, 0, 0, 0]
    });
    this._blurPass2 = new Pass$1({
        fragment: claygl.Shader.source('car.ssr.blur'),
        clearColor: [0, 0, 0, 0]
    });
    this._blendPass = new Pass$1({
        fragment: claygl.Shader.source('clay.compositor.blend')
    });
    this._blendPass.material.disableTexturesAll();
    this._blendPass.material.enableTexture(['texture1', 'texture2']);

    this._ssrPass.setUniform('gBufferTexture1', opt.normalTexture);
    this._ssrPass.setUniform('gBufferTexture2', opt.depthTexture);
    this._ssrPass.setUniform('gBufferTexture3', opt.albedoTexture);

    this._blurPass1.setUniform('gBufferTexture1', opt.normalTexture);
    this._blurPass1.setUniform('gBufferTexture2', opt.depthTexture);

    this._blurPass2.setUniform('gBufferTexture1', opt.normalTexture);
    this._blurPass2.setUniform('gBufferTexture2', opt.depthTexture);

    this._blurPass2.material.define('fragment', 'VERTICAL');
    this._blurPass2.material.define('fragment', 'BLEND');

    this._ssrTexture = new claygl.Texture2D({
        type: claygl.Texture.HALF_FLOAT
    });
    this._texture2 = new claygl.Texture2D({
        type: claygl.Texture.HALF_FLOAT
    });
    this._texture3 = new claygl.Texture2D({
        type: claygl.Texture.HALF_FLOAT
    });
    this._prevTexture = new claygl.Texture2D({
        type: claygl.Texture.HALF_FLOAT
    });
    this._currentTexture = new claygl.Texture2D({
        type: claygl.Texture.HALF_FLOAT
    });

    this._frameBuffer = new claygl.FrameBuffer({
        depthBuffer: false
    });

    this._normalDistribution = null;

    this._totalSamples = 256;
    this._samplePerFrame = 4;

    this._ssrPass.material.define('fragment', 'SAMPLE_PER_FRAME', this._samplePerFrame);
    this._ssrPass.material.define('fragment', 'TOTAL_SAMPLES', this._totalSamples);

    this._downScale = 1;
}

SSRPass.prototype.setAmbientCubemap = function (specularCubemap, brdfLookup, specularIntensity) {
    this._ssrPass.material.set('specularCubemap', specularCubemap);
    this._ssrPass.material.set('brdfLookup', brdfLookup);
    this._ssrPass.material.set('specularIntensity', specularIntensity);

    var enableSpecularMap = specularCubemap && specularIntensity;
    this._ssrPass.material[enableSpecularMap ? 'enableTexture' : 'disableTexture']('specularCubemap');
};

SSRPass.prototype.update = function (renderer, camera$$1, sourceTexture, frame) {
    var width = renderer.getWidth();
    var height = renderer.getHeight();
    var ssrTexture = this._ssrTexture;
    var texture2 = this._texture2;
    var texture3 = this._texture3;
    ssrTexture.width = this._prevTexture.width = this._currentTexture.width = width / this._downScale;
    ssrTexture.height = this._prevTexture.height = this._currentTexture.height = height / this._downScale;

    texture2.width = texture3.width = width;
    texture2.height = texture3.height = height;

    var frameBuffer = this._frameBuffer;

    var ssrPass = this._ssrPass;
    var blurPass1 = this._blurPass1;
    var blurPass2 = this._blurPass2;
    var blendPass = this._blendPass;

    var toViewSpace = new claygl.Matrix4();
    var toWorldSpace = new claygl.Matrix4();
    claygl.Matrix4.transpose(toViewSpace, camera$$1.worldTransform);
    claygl.Matrix4.transpose(toWorldSpace, camera$$1.viewMatrix);

    ssrPass.setUniform('sourceTexture', sourceTexture);
    ssrPass.setUniform('projection', camera$$1.projectionMatrix.array);
    ssrPass.setUniform('projectionInv', camera$$1.invProjectionMatrix.array);
    ssrPass.setUniform('toViewSpace', toViewSpace.array);
    ssrPass.setUniform('toWorldSpace', toWorldSpace.array);
    ssrPass.setUniform('nearZ', camera$$1.near);

    var percent = frame / this._totalSamples * this._samplePerFrame;
    ssrPass.setUniform('jitterOffset', percent);
    ssrPass.setUniform('sampleOffset', frame * this._samplePerFrame);
    // ssrPass.setUniform('lambertNormals', this._diffuseSampleNormals[frame % this._totalSamples]);

    blurPass1.setUniform('textureSize', [ssrTexture.width, ssrTexture.height]);
    blurPass2.setUniform('textureSize', [width, height]);
    blurPass2.setUniform('sourceTexture', sourceTexture);

    blurPass1.setUniform('projection', camera$$1.projectionMatrix.array);
    blurPass2.setUniform('projection', camera$$1.projectionMatrix.array);

    frameBuffer.attach(ssrTexture);
    frameBuffer.bind(renderer);
    ssrPass.render(renderer);

    if (this._physicallyCorrect) {
        frameBuffer.attach(this._currentTexture);
        blendPass.setUniform('texture1', this._prevTexture);
        blendPass.setUniform('texture2', ssrTexture);
        blendPass.material.set({
            'weight1': frame >= 1 ? 0.95 : 0,
            'weight2': frame >= 1 ? 0.05 : 1
            // weight1: frame >= 1 ? 1 : 0,
            // weight2: 1
        });
        blendPass.render(renderer);
    }

    frameBuffer.attach(texture2);
    blurPass1.setUniform('texture', this._physicallyCorrect ? this._currentTexture : ssrTexture);
    blurPass1.render(renderer);

    frameBuffer.attach(texture3);
    blurPass2.setUniform('texture', texture2);
    blurPass2.render(renderer);
    frameBuffer.unbind(renderer);

    if (this._physicallyCorrect) {
        var tmp = this._prevTexture;
        this._prevTexture = this._currentTexture;
        this._currentTexture = tmp;
    }
};

SSRPass.prototype.getTargetTexture = function () {
    return this._texture3;
};

SSRPass.prototype.setParameter = function (name, val) {
    if (name === 'maxIteration') {
        this._ssrPass.material.define('fragment', 'MAX_ITERATION', val);
    }
    else {
        this._ssrPass.setUniform(name, val);
    }
};

SSRPass.prototype.setPhysicallyCorrect = function (isPhysicallyCorrect) {
    if (isPhysicallyCorrect) {
        if (!this._normalDistribution) {
            this._normalDistribution = cubemapUtil.generateNormalDistribution(64, this._totalSamples);
        }
        this._ssrPass.material.define('fragment', 'PHYSICALLY_CORRECT');
        this._ssrPass.material.set('normalDistribution', this._normalDistribution);
        this._ssrPass.material.set('normalDistributionSize', [64, this._totalSamples]);
    }
    else {
        this._ssrPass.material.undefine('fragment', 'PHYSICALLY_CORRECT');
    }

    this._physicallyCorrect = isPhysicallyCorrect;
};

SSRPass.prototype.setSSAOTexture = function (texture) {
    var blendPass = this._blurPass2;
    if (texture) {
        blendPass.material.enableTexture('ssaoTex');
        blendPass.material.set('ssaoTex', texture);
    }
    else {
        blendPass.material.disableTexture('ssaoTex');
    }
};

SSRPass.prototype.isFinished = function (frame) {
    if (this._physicallyCorrect) {
        return frame > (this._totalSamples / this._samplePerFrame);
    }
    else {
        return true;
    }
};

SSRPass.prototype.dispose = function (renderer) {
    this._ssrTexture.dispose(renderer);
    this._texture2.dispose(renderer);
    this._texture3.dispose(renderer);
    this._prevTexture.dispose(renderer);
    this._currentTexture.dispose(renderer);
    this._frameBuffer.dispose(renderer);
};

// Based on https://bl.ocks.org/mbostock/19168c663618b707158

var poissonKernel = [
0.0, 0.0,
-0.321585265978, -0.154972575841,
0.458126042375, 0.188473391593,
0.842080129861, 0.527766490688,
0.147304551086, -0.659453822776,
-0.331943915203, -0.940619700594,
0.0479226680259, 0.54812163202,
0.701581552186, -0.709825561388,
-0.295436780218, 0.940589268233,
-0.901489676764, 0.237713156085,
0.973570876096, -0.109899459384,
-0.866792314779, -0.451805525005,
0.330975007087, 0.800048655954,
-0.344275183665, 0.381779221166,
-0.386139432542, -0.437418421534,
-0.576478634965, -0.0148463392551,
0.385798197415, -0.262426961053,
-0.666302061145, 0.682427250835,
-0.628010632582, -0.732836215494,
0.10163141741, -0.987658134403,
0.711995289051, -0.320024291314,
0.0296005138058, 0.950296523438,
0.0130612307608, -0.351024443122,
-0.879596633704, -0.10478487883,
0.435712737232, 0.504254490347,
0.779203817497, 0.206477676721,
0.388264289969, -0.896736162545,
-0.153106280781, -0.629203242522,
-0.245517550697, 0.657969239148,
0.126830499058, 0.26862328493,
-0.634888119007, -0.302301223431,
0.617074219636, 0.779817204925
];

var effectJson = {
    'type' : 'compositor',
    'nodes' : [
        {
            'name': 'source',
            'type': 'texture',
            'outputs': {
                'color': {}
            }
        },
        {
            'name': 'source_half',
            'shader': '#source(clay.compositor.downsample)',
            'inputs': {
                'texture': 'source'
            },
            'outputs': {
                'color': {
                    'parameters': {
                        'width': 'expr(width * 1.0 / 2)',
                        'height': 'expr(height * 1.0 / 2)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'textureSize': 'expr( [width * 1.0, height * 1.0] )'
            }
        },


        {
            'name' : 'bright',
            'shader' : '#source(clay.compositor.bright)',
            'inputs' : {
                'texture' : 'source_half'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0 / 2)',
                        'height' : 'expr(height * 1.0 / 2)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'threshold' : 2,
                'scale': 4,
                'textureSize': 'expr([width * 1.0 / 2, height / 2])'
            }
        },

        {
            'name': 'bright_downsample_4',
            'shader' : '#source(clay.compositor.downsample)',
            'inputs' : {
                'texture' : 'bright'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0 / 4)',
                        'height' : 'expr(height * 1.0 / 4)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'textureSize': 'expr( [width * 1.0 / 2, height / 2] )'
            }
        },
        {
            'name': 'bright_downsample_8',
            'shader' : '#source(clay.compositor.downsample)',
            'inputs' : {
                'texture' : 'bright_downsample_4'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0 / 8)',
                        'height' : 'expr(height * 1.0 / 8)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'textureSize': 'expr( [width * 1.0 / 4, height / 4] )'
            }
        },
        {
            'name': 'bright_downsample_16',
            'shader' : '#source(clay.compositor.downsample)',
            'inputs' : {
                'texture' : 'bright_downsample_8'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0 / 16)',
                        'height' : 'expr(height * 1.0 / 16)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'textureSize': 'expr( [width * 1.0 / 8, height / 8] )'
            }
        },
        {
            'name': 'bright_downsample_32',
            'shader' : '#source(clay.compositor.downsample)',
            'inputs' : {
                'texture' : 'bright_downsample_16'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0 / 32)',
                        'height' : 'expr(height * 1.0 / 32)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'textureSize': 'expr( [width * 1.0 / 16, height / 16] )'
            }
        },


        {
            'name' : 'bright_upsample_16_blur_h',
            'shader' : '#source(clay.compositor.gaussian_blur)',
            'inputs' : {
                'texture' : 'bright_downsample_32'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0 / 16)',
                        'height' : 'expr(height * 1.0 / 16)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'blurSize' : 1,
                'blurDir': 0.0,
                'textureSize': 'expr( [width * 1.0 / 32, height / 32] )'
            }
        },
        {
            'name' : 'bright_upsample_16_blur_v',
            'shader' : '#source(clay.compositor.gaussian_blur)',
            'inputs' : {
                'texture' : 'bright_upsample_16_blur_h'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0 / 16)',
                        'height' : 'expr(height * 1.0 / 16)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'blurSize' : 1,
                'blurDir': 1.0,
                'textureSize': 'expr( [width * 1.0 / 32, height * 1.0 / 32] )'
            }
        },



        {
            'name' : 'bright_upsample_8_blur_h',
            'shader' : '#source(clay.compositor.gaussian_blur)',
            'inputs' : {
                'texture' : 'bright_downsample_16'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0 / 8)',
                        'height' : 'expr(height * 1.0 / 8)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'blurSize' : 1,
                'blurDir': 0.0,
                'textureSize': 'expr( [width * 1.0 / 16, height * 1.0 / 16] )'
            }
        },
        {
            'name' : 'bright_upsample_8_blur_v',
            'shader' : '#source(clay.compositor.gaussian_blur)',
            'inputs' : {
                'texture' : 'bright_upsample_8_blur_h'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0 / 8)',
                        'height' : 'expr(height * 1.0 / 8)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'blurSize' : 1,
                'blurDir': 1.0,
                'textureSize': 'expr( [width * 1.0 / 16, height * 1.0 / 16] )'
            }
        },
        {
            'name' : 'bright_upsample_8_blend',
            'shader' : '#source(clay.compositor.blend)',
            'inputs' : {
                'texture1' : 'bright_upsample_8_blur_v',
                'texture2' : 'bright_upsample_16_blur_v'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0 / 8)',
                        'height' : 'expr(height * 1.0 / 8)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'weight1' : 0.3,
                'weight2' : 0.7
            }
        },


        {
            'name' : 'bright_upsample_4_blur_h',
            'shader' : '#source(clay.compositor.gaussian_blur)',
            'inputs' : {
                'texture' : 'bright_downsample_8'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0 / 4)',
                        'height' : 'expr(height * 1.0 / 4)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'blurSize' : 1,
                'blurDir': 0.0,
                'textureSize': 'expr( [width * 1.0 / 8, height * 1.0 / 8] )'
            }
        },
        {
            'name' : 'bright_upsample_4_blur_v',
            'shader' : '#source(clay.compositor.gaussian_blur)',
            'inputs' : {
                'texture' : 'bright_upsample_4_blur_h'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0 / 4)',
                        'height' : 'expr(height * 1.0 / 4)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'blurSize' : 1,
                'blurDir': 1.0,
                'textureSize': 'expr( [width * 1.0 / 8, height * 1.0 / 8] )'
            }
        },
        {
            'name' : 'bright_upsample_4_blend',
            'shader' : '#source(clay.compositor.blend)',
            'inputs' : {
                'texture1' : 'bright_upsample_4_blur_v',
                'texture2' : 'bright_upsample_8_blend'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0 / 4)',
                        'height' : 'expr(height * 1.0 / 4)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'weight1' : 0.3,
                'weight2' : 0.7
            }
        },





        {
            'name' : 'bright_upsample_2_blur_h',
            'shader' : '#source(clay.compositor.gaussian_blur)',
            'inputs' : {
                'texture' : 'bright_downsample_4'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0 / 2)',
                        'height' : 'expr(height * 1.0 / 2)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'blurSize' : 1,
                'blurDir': 0.0,
                'textureSize': 'expr( [width * 1.0 / 4, height * 1.0 / 4] )'
            }
        },
        {
            'name' : 'bright_upsample_2_blur_v',
            'shader' : '#source(clay.compositor.gaussian_blur)',
            'inputs' : {
                'texture' : 'bright_upsample_2_blur_h'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0 / 2)',
                        'height' : 'expr(height * 1.0 / 2)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'blurSize' : 1,
                'blurDir': 1.0,
                'textureSize': 'expr( [width * 1.0 / 4, height * 1.0 / 4] )'
            }
        },
        {
            'name' : 'bright_upsample_2_blend',
            'shader' : '#source(clay.compositor.blend)',
            'inputs' : {
                'texture1' : 'bright_upsample_2_blur_v',
                'texture2' : 'bright_upsample_4_blend'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0 / 2)',
                        'height' : 'expr(height * 1.0 / 2)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'weight1' : 0.3,
                'weight2' : 0.7
            }
        },



        {
            'name' : 'bright_upsample_full_blur_h',
            'shader' : '#source(clay.compositor.gaussian_blur)',
            'inputs' : {
                'texture' : 'bright'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0)',
                        'height' : 'expr(height * 1.0)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'blurSize' : 1,
                'blurDir': 0.0,
                'textureSize': 'expr( [width * 1.0 / 2, height * 1.0 / 2] )'
            }
        },
        {
            'name' : 'bright_upsample_full_blur_v',
            'shader' : '#source(clay.compositor.gaussian_blur)',
            'inputs' : {
                'texture' : 'bright_upsample_full_blur_h'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0)',
                        'height' : 'expr(height * 1.0)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'blurSize' : 1,
                'blurDir': 1.0,
                'textureSize': 'expr( [width * 1.0 / 2, height * 1.0 / 2] )'
            }
        },
        {
            'name' : 'bloom_composite',
            'shader' : '#source(clay.compositor.blend)',
            'inputs' : {
                'texture1' : 'bright_upsample_full_blur_v',
                'texture2' : 'bright_upsample_2_blend'
            },
            'outputs' : {
                'color' : {
                    'parameters' : {
                        'width' : 'expr(width * 1.0)',
                        'height' : 'expr(height * 1.0)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters' : {
                'weight1' : 0.3,
                'weight2' : 0.7
            }
        },


        {
            'name': 'coc',
            'shader': '#source(car.dof.coc)',
            'outputs': {
                'color': {
                    'parameters': {
                        'minFilter': 'NEAREST',
                        'magFilter': 'NEAREST',
                        'width': 'expr(width * 1.0)',
                        'height': 'expr(height * 1.0)'
                    }
                }
            },
            'parameters': {
                'focalDist': 50,
                'focalRange': 30
            }
        },

        {
            'name': 'dof_far_blur',
            'shader': '#source(car.dof.diskBlur)',
            'inputs': {
                'texture': 'source',
                'coc': 'coc'
            },
            'outputs': {
                'color': {
                    'parameters': {
                        'width': 'expr(width * 1.0)',
                        'height': 'expr(height * 1.0)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters': {
                'textureSize': 'expr( [width * 1.0, height * 1.0] )'
            }
        },
        {
            'name': 'dof_near_blur',
            'shader': '#source(car.dof.diskBlur)',
            'inputs': {
                'texture': 'source',
                'coc': 'coc'
            },
            'outputs': {
                'color': {
                    'parameters': {
                        'width': 'expr(width * 1.0)',
                        'height': 'expr(height * 1.0)',
                        'type': 'HALF_FLOAT'
                    }
                }
            },
            'parameters': {
                'textureSize': 'expr( [width * 1.0, height * 1.0] )'
            },
            'defines': {
                'BLUR_NEARFIELD': null
            }
        },


        {
            'name': 'dof_coc_blur',
            'shader': '#source(car.dof.diskBlur)',
            'inputs': {
                'texture': 'coc'
            },
            'outputs': {
                'color': {
                    'parameters': {
                        'minFilter': 'NEAREST',
                        'magFilter': 'NEAREST',
                        'width': 'expr(width * 1.0)',
                        'height': 'expr(height * 1.0)'
                    }
                }
            },
            'parameters': {
                'textureSize': 'expr( [width * 1.0, height * 1.0] )'
            },
            'defines': {
                'BLUR_COC': null
            }
        },

        {
            'name': 'dof_composite',
            'shader': '#source(car.dof.composite)',
            'inputs': {
                'original': 'source',
                'blurred': 'dof_far_blur',
                'nearfield': 'dof_near_blur',
                'coc': 'coc',
                'nearcoc': 'dof_coc_blur'
            },
            'outputs': {
                'color': {
                    'parameters': {
                        'width': 'expr(width * 1.0)',
                        'height': 'expr(height * 1.0)',
                        'type': 'HALF_FLOAT'
                    }
                }
            }
        },
        {
            'name' : 'composite',
            'shader' : '#source(clay.compositor.hdr.composite)',
            'inputs' : {
                'texture': 'source',
                'bloom' : 'bloom_composite'
            },
            'defines': {
                // Images are all premultiplied alpha before composite because of blending.
                // 'PREMULTIPLY_ALPHA': null,
                // 'DEBUG': 1
            }
        },
        {
            'name' : 'FXAA',
            'shader' : '#source(clay.compositor.fxaa)',
            'inputs' : {
                'texture' : 'composite'
            }
        }
    ]
};

var dofCode = "@export car.dof.coc\nuniform sampler2D depth;\nuniform float zNear: 0.1;\nuniform float zFar: 2000;\nuniform float focalDistance: 3;\nuniform float focalRange: 1;\nuniform float focalLength: 30;\nuniform float fstop: 2.8;\nvarying vec2 v_Texcoord;\n@import clay.util.encode_float\nvoid main()\n{\n float z = texture2D(depth, v_Texcoord).r * 2.0 - 1.0;\n float dist = 2.0 * zNear * zFar / (zFar + zNear - z * (zFar - zNear));\n float aperture = focalLength / fstop;\n float coc;\n float uppper = focalDistance + focalRange;\n float lower = focalDistance - focalRange;\n if (dist <= uppper && dist >= lower) {\n coc = 0.5;\n }\n else {\n float focalAdjusted = dist > uppper ? uppper : lower;\n coc = abs(aperture * (focalLength * (dist - focalAdjusted)) / (dist * (focalAdjusted - focalLength)));\n coc = clamp(coc, 0.0, 2.0) / 2.00001;\n if (dist < lower) {\n coc = -coc;\n }\n coc = coc * 0.5 + 0.5;\n }\n gl_FragColor = encodeFloat(coc);\n}\n@end\n@export car.dof.composite\n#define DEBUG 0\nuniform sampler2D original;\nuniform sampler2D blurred;\nuniform sampler2D nearfield;\nuniform sampler2D coc;\nuniform sampler2D nearcoc;\nvarying vec2 v_Texcoord;\n@import clay.util.rgbm\n@import clay.util.float\nvoid main()\n{\n vec4 blurredColor = decodeHDR(texture2D(blurred, v_Texcoord));\n vec4 originalColor = decodeHDR(texture2D(original, v_Texcoord));\n float fCoc = decodeFloat(texture2D(coc, v_Texcoord));\n fCoc = abs(fCoc * 2.0 - 1.0);\n float weight = smoothstep(0.0, 1.0, fCoc);\n#ifdef NEARFIELD_ENABLED\n vec4 nearfieldColor = decodeHDR(texture2D(nearfield, v_Texcoord));\n float fNearCoc = decodeFloat(texture2D(nearcoc, v_Texcoord));\n fNearCoc = abs(fNearCoc * 2.0 - 1.0);\n gl_FragColor = encodeHDR(\n mix(\n nearfieldColor, mix(originalColor, blurredColor, weight),\n pow(1.0 - fNearCoc, 4.0)\n )\n );\n#else\n gl_FragColor = encodeHDR(mix(originalColor, blurredColor, weight));\n#endif\n}\n@end\n@export car.dof.diskBlur\n#define POISSON_KERNEL_SIZE 16;\nuniform sampler2D texture;\nuniform sampler2D coc;\nvarying vec2 v_Texcoord;\nuniform float blurRadius : 10.0;\nuniform vec2 textureSize : [512.0, 512.0];\nuniform vec2 poissonKernel[POISSON_KERNEL_SIZE];\nuniform float percent;\nfloat nrand(const in vec2 n) {\n return fract(sin(dot(n.xy ,vec2(12.9898,78.233))) * 43758.5453);\n}\n@import clay.util.rgbm\n@import clay.util.float\nvoid main()\n{\n vec2 offset = blurRadius / textureSize;\n float rnd = 6.28318 * nrand(v_Texcoord + 0.07 * percent );\n float cosa = cos(rnd);\n float sina = sin(rnd);\n vec4 basis = vec4(cosa, -sina, sina, cosa);\n#if !defined(BLUR_NEARFIELD) && !defined(BLUR_COC)\n offset *= abs(decodeFloat(texture2D(coc, v_Texcoord)) * 2.0 - 1.0);\n#endif\n#ifdef BLUR_COC\n float cocSum = 0.0;\n#else\n vec4 color = vec4(0.0);\n#endif\n float weightSum = 0.0;\n for (int i = 0; i < POISSON_KERNEL_SIZE; i++) {\n vec2 ofs = poissonKernel[i];\n ofs = vec2(dot(ofs, basis.xy), dot(ofs, basis.zw));\n vec2 uv = v_Texcoord + ofs * offset;\n vec4 texel = texture2D(texture, uv);\n float w = 1.0;\n#ifdef BLUR_COC\n float fCoc = decodeFloat(texel) * 2.0 - 1.0;\n cocSum += clamp(fCoc, -1.0, 0.0) * w;\n#else\n texel = decodeHDR(texel);\n #if !defined(BLUR_NEARFIELD)\n float fCoc = decodeFloat(texture2D(coc, uv)) * 2.0 - 1.0;\n w *= abs(fCoc);\n #endif\n color += texel * w;\n#endif\n weightSum += w;\n }\n#ifdef BLUR_COC\n gl_FragColor = encodeFloat(clamp(cocSum / weightSum, -1.0, 0.0) * 0.5 + 0.5);\n#else\n color /= weightSum;\n gl_FragColor = encodeHDR(color);\n#endif\n}\n@end";

var temporalBlendCode = "@export car.temporalBlend\nuniform sampler2D prevTex;\nuniform sampler2D currTex;\nuniform sampler2D velocityTex;\nvarying vec2 v_Texcoord;\nvoid main() {\n vec4 vel = texture2D(velocityTex, v_Texcoord);\n vec4 curr = texture2D(currTex, v_Texcoord);\n vec4 prev = texture2D(prevTex, v_Texcoord - vel.rg);\n if (length(vel.rg) > 0.1 || vel.a < 0.01) {\n gl_FragColor = curr;\n }\n else {\n gl_FragColor = mix(prev, curr, 0.1);\n }\n}\n@end";

var GBuffer = claygl.deferred.GBuffer;

claygl.Shader.import(dofCode);

claygl.Shader.import(temporalBlendCode);

var commonOutputs = {
    color: {
        parameters: {
            width: function (renderer) {
                return renderer.getWidth();
            },
            height: function (renderer) {
                return renderer.getHeight();
            }
        }
    }
};

var FINAL_NODES_CHAIN = ['composite', 'FXAA'];

function EffectCompositor() {
    this._sourceTexture = new claygl.Texture2D({
        type: claygl.Texture.HALF_FLOAT
    });
    this._depthTexture = new claygl.Texture2D({
        format: claygl.Texture.DEPTH_COMPONENT,
        type: claygl.Texture.UNSIGNED_INT
    });

    this._framebuffer = new claygl.FrameBuffer();
    this._framebuffer.attach(this._sourceTexture);
    this._framebuffer.attach(this._depthTexture, claygl.FrameBuffer.DEPTH_ATTACHMENT);

    this._gBufferPass = new GBuffer({
        renderTransparent: true,
        enableTargetTexture3: false,
        enableTargetTexture4: true
    });

    this._compositor = claygl.createCompositor(effectJson);

    var sourceNode = this._compositor.getNodeByName('source');
    sourceNode.texture = this._sourceTexture;
    var cocNode = this._compositor.getNodeByName('coc');

    this._sourceNode = sourceNode;
    this._cocNode = cocNode;
    this._compositeNode = this._compositor.getNodeByName('composite');
    this._fxaaNode = this._compositor.getNodeByName('FXAA');

    this._dofBlurNodes = ['dof_far_blur', 'dof_near_blur', 'dof_coc_blur'].map(function (name) {
        return this._compositor.getNodeByName(name);
    }, this);

    this._dofBlurKernel = null;
    this._dofBlurKernelSize = new Float32Array(0);

    this._finalNodesChain = FINAL_NODES_CHAIN.map(function (name) {
        return this._compositor.getNodeByName(name);
    }, this);

    var gBufferObj = {
        normalTexture: this._gBufferPass.getTargetTexture1(),
        depthTexture: this._gBufferPass.getTargetTexture2(),
        albedoTexture: this._gBufferPass.getTargetTexture3(),
        velocityTexture: this._gBufferPass.getTargetTexture4()
    };
    this._ssaoPass = new SSAOPass(gBufferObj);
    this._ssrPass = new SSRPass(gBufferObj);
}

EffectCompositor.prototype.resize = function (width, height, dpr) {
    dpr = dpr || 1;
    width = width * dpr;
    height = height * dpr;
    var sourceTexture = this._sourceTexture;
    var depthTexture = this._depthTexture;

    sourceTexture.width = width;
    sourceTexture.height = height;
    depthTexture.width = width;
    depthTexture.height = height;

    this._gBufferPass.resize(width, height);
};

EffectCompositor.prototype._ifRenderNormalPass = function () {
    return this._enableSSAO || this._enableEdge || this._enableSSR;
};

EffectCompositor.prototype._getPrevNode = function (node) {
    var idx = FINAL_NODES_CHAIN.indexOf(node.name) - 1;
    var prevNode = this._finalNodesChain[idx];
    while (prevNode && !this._compositor.getNodeByName(prevNode.name)) {
        idx -= 1;
        prevNode = this._finalNodesChain[idx];
    }
    return prevNode;
};
EffectCompositor.prototype._getNextNode = function (node) {
    var idx = FINAL_NODES_CHAIN.indexOf(node.name) + 1;
    var nextNode = this._finalNodesChain[idx];
    while (nextNode && !this._compositor.getNodeByName(nextNode.name)) {
        idx += 1;
        nextNode = this._finalNodesChain[idx];
    }
    return nextNode;
};
EffectCompositor.prototype._addChainNode = function (node) {
    var prevNode = this._getPrevNode(node);
    var nextNode = this._getNextNode(node);
    if (!prevNode) {
        return;
    }

    prevNode.outputs = commonOutputs;
    node.inputs.texture = prevNode.name;
    if (nextNode) {
        node.outputs = commonOutputs;
        nextNode.inputs.texture = node.name;
    }
    else {
        node.outputs = null;
    }
    this._compositor.addNode(node);
};
EffectCompositor.prototype._removeChainNode = function (node) {
    var prevNode = this._getPrevNode(node);
    var nextNode = this._getNextNode(node);
    if (!prevNode) {
        return;
    }

    if (nextNode) {
        prevNode.outputs = commonOutputs;
        nextNode.inputs.texture = prevNode.name;
    }
    else {
        prevNode.outputs = null;
    }
    this._compositor.removeNode(node);
};
/**
 * Update normal
 */
EffectCompositor.prototype.updateGBuffer = function (renderer, scene, camera$$1, frame) {
    if (this._ifRenderNormalPass()) {
        this._gBufferPass.update(renderer, scene, camera$$1);
    }
};

/**
 * Render SSAO after render the scene, before compositing
 */
EffectCompositor.prototype.updateSSAO = function (renderer, scene, camera$$1, frame) {
    this._ssaoPass.update(renderer, camera$$1, frame);
};

/**
 * Enable SSAO effect
 */
EffectCompositor.prototype.enableSSAO = function () {
    this._enableSSAO = true;
};

/**
 * Disable SSAO effect
 */
EffectCompositor.prototype.disableSSAO = function () {
    this._enableSSAO = false;
};

/**
 * Enable SSR effect
 */
EffectCompositor.prototype.enableSSR = function () {
    this._enableSSR = true;
    this._gBufferPass.enableTargetTexture3 = true;
};
/**
 * Disable SSR effect
 */
EffectCompositor.prototype.disableSSR = function () {
    this._enableSSR = false;
    this._gBufferPass.enableTargetTexture3 = false;
};

/**
 * Render SSAO after render the scene, before compositing
 */
EffectCompositor.prototype.getSSAOTexture = function () {
    return this._ssaoPass.getTargetTexture();
};

/**
 * @return {clay.FrameBuffer}
 */
EffectCompositor.prototype.getSourceFrameBuffer = function () {
    return this._framebuffer;
};

/**
 * @return {clay.Texture2D}
 */
EffectCompositor.prototype.getSourceTexture = function () {
    return this._sourceTexture;
};

EffectCompositor.prototype.getVelocityTexture = function () {
    return this._gBufferPass.getTargetTexture4();
};
EffectCompositor.prototype.getDepthTexture = function () {
    return this._gBufferPass.getTargetTexture2();
};

/**
 * Disable fxaa effect
 */
EffectCompositor.prototype.disableFXAA = function () {
    this._removeChainNode(this._fxaaNode);
};

/**
 * Enable fxaa effect
 */
EffectCompositor.prototype.enableFXAA = function () {
    this._addChainNode(this._fxaaNode);
};

/**
 * Enable bloom effect
 */
EffectCompositor.prototype.enableBloom = function () {
    this._compositeNode.inputs.bloom = 'bloom_composite';
    this._compositor.dirty();
};

/**
 * Disable bloom effect
 */
EffectCompositor.prototype.disableBloom = function () {
    this._compositeNode.inputs.bloom = null;
    this._compositor.dirty();
};

/**
 * Enable depth of field effect
 */
EffectCompositor.prototype.enableDOF = function () {
    this._compositeNode.inputs.texture = 'dof_composite';
    this._compositor.dirty();
};
/**
 * Disable depth of field effect
 */
EffectCompositor.prototype.disableDOF = function () {
    this._compositeNode.inputs.texture = 'source';
    this._compositor.dirty();
};

/**
 * Enable color correction
 */
EffectCompositor.prototype.enableColorCorrection = function () {
    this._compositeNode.define('COLOR_CORRECTION');
    this._enableColorCorrection = true;
};
/**
 * Disable color correction
 */
EffectCompositor.prototype.disableColorCorrection = function () {
    this._compositeNode.undefine('COLOR_CORRECTION');
    this._enableColorCorrection = false;
};

/**
 * Enable edge detection
 */
EffectCompositor.prototype.enableEdge = function () {
    this._enableEdge = true;
};

/**
 * Disable edge detection
 */
EffectCompositor.prototype.disableEdge = function () {
    this._enableEdge = false;
};

/**
 * Set bloom intensity
 * @param {number} value
 */
EffectCompositor.prototype.setBloomIntensity = function (value) {
    if (value == null) {
        return;
    }
    this._compositeNode.setParameter('bloomIntensity', value);
};

EffectCompositor.prototype.setSSAOParameter = function (name, value) {
    if (value == null) {
        return;
    }
    switch (name) {
        case 'quality':
            // PENDING
            var kernelSize = ({
                low: 6,
                medium: 12,
                high: 32,
                ultra: 62
            })[value] || 12;
            this._ssaoPass.setParameter('kernelSize', kernelSize);
            break;
        case 'radius':
            this._ssaoPass.setParameter(name, value);
            this._ssaoPass.setParameter('bias', value / 50);
            break;
        case 'intensity':
            this._ssaoPass.setParameter(name, value);
            break;
    }
};

EffectCompositor.prototype.setDOFParameter = function (name, value) {
    if (value == null) {
        return;
    }
    switch (name) {
        case 'focalDistance':
        case 'focalRange':
        case 'fstop':
            this._cocNode.setParameter(name, value);
            break;
        case 'blurRadius':
            for (var i = 0; i < this._dofBlurNodes.length; i++) {
                this._dofBlurNodes[i].setParameter('blurRadius', value);
            }
            break;
        case 'quality':
            var kernelSize = ({
                low: 4, medium: 8, high: 16, ultra: 32
            })[value] || 8;
            this._dofBlurKernelSize = kernelSize;
            for (var i = 0; i < this._dofBlurNodes.length; i++) {
                this._dofBlurNodes[i].define('POISSON_KERNEL_SIZE', kernelSize);
            }
            this._dofBlurKernel = new Float32Array(kernelSize * 2);
            break;
    }
};

EffectCompositor.prototype.setSSRParameter = function (name, value) {
    if (value == null) {
        return;
    }
    switch (name) {
        case 'quality':
            // PENDING
            var maxIteration = ({
                low: 10,
                medium: 15,
                high: 30,
                ultra: 80
            })[value] || 20;
            var pixelStride = ({
                low: 32,
                medium: 16,
                high: 8,
                ultra: 4
            })[value] || 16;
            this._ssrPass.setParameter('maxIteration', maxIteration);
            this._ssrPass.setParameter('pixelStride', pixelStride);
            break;
        case 'maxRoughness':
            this._ssrPass.setParameter('minGlossiness', Math.max(Math.min(1.0 - value, 1.0), 0.0));
            break;
        case 'physical':
            this.setPhysicallyCorrectSSR(value);
            break;
        default:
            console.warn('Unkown SSR parameter ' + name);
    }
};

EffectCompositor.prototype.setPhysicallyCorrectSSR = function (physical) {
    this._ssrPass.setPhysicallyCorrect(physical);
};
/**
 * Set color of edge
 */
EffectCompositor.prototype.setEdgeColor = function (value) {
    // if (value == null) {
    //     return;
    // }
    // this._edgePass.setParameter('edgeColor', value);
};

EffectCompositor.prototype.setExposure = function (value) {
    if (value == null) {
        return;
    }
    this._compositeNode.setParameter('exposure', Math.pow(2, value));
};

EffectCompositor.prototype.setColorLookupTexture = function (image, api) {
    // this._compositeNode.pass.material.setTextureImage('lut', this._enableColorCorrection ? image : 'none', api, {
    //     minFilter: Texture.NEAREST,
    //     magFilter: Texture.NEAREST,
    //     flipY: false
    // });
};
EffectCompositor.prototype.setColorCorrection = function (type, value) {
    this._compositeNode.setParameter(type, value);
};

EffectCompositor.prototype.composite = function (renderer, scene, camera$$1, framebuffer, frame) {

    var sourceTexture = this._sourceTexture;
    var targetTexture = sourceTexture;

    if (this._enableSSR) {
        this._ssrPass.update(renderer, camera$$1, sourceTexture, frame);
        targetTexture = this._ssrPass.getTargetTexture();

        this._ssrPass.setSSAOTexture(
            this._enableSSAO ? this._ssaoPass.getTargetTexture() : null
        );
        var lights = scene.getLights();
        for (var i = 0; i < lights.length; i++) {
            if (lights[i].cubemap) {
                this._ssrPass.setAmbientCubemap(
                    lights[i].cubemap,
                    // lights[i].getBRDFLookup(),
                    lights[i]._brdfLookup,
                    lights[i].intensity
                );
            }
        }
    }
    this._sourceNode.texture = targetTexture;

    this._cocNode.setParameter('depth', this._depthTexture);

    var blurKernel = this._dofBlurKernel;
    var blurKernelSize = this._dofBlurKernelSize;
    var frameAll = Math.floor(poissonKernel.length / 2 / blurKernelSize);
    var kernelOffset = frame % frameAll;

    for (var i = 0; i < blurKernelSize * 2; i++) {
        blurKernel[i] = poissonKernel[i + kernelOffset * blurKernelSize * 2];
    }

    for (var i = 0; i < this._dofBlurNodes.length; i++) {
        this._dofBlurNodes[i].setParameter('percent', frame / 30.0);
        this._dofBlurNodes[i].setParameter('poissonKernel', blurKernel);
    }

    this._cocNode.setParameter('zNear', camera$$1.near);
    this._cocNode.setParameter('zFar', camera$$1.far);

    this._compositor.render(renderer, framebuffer);
};

EffectCompositor.prototype.isSSRFinished = function (frame) {
    return this._ssrPass ? this._ssrPass.isFinished(frame) : true;
};

EffectCompositor.prototype.isSSAOFinished = function (frame) {
    return this._ssaoPass ? this._ssaoPass.isFinished(frame) : true;
};

EffectCompositor.prototype.isSSREnabled = function () {
    return this._enableSSR;
};

EffectCompositor.prototype.dispose = function (renderer) {
    this._sourceTexture.dispose(renderer);
    this._depthTexture.dispose(renderer);
    this._framebuffer.dispose(renderer);
    this._compositor.dispose(renderer);

    this._gBufferPass.dispose(renderer);
    this._ssaoPass.dispose(renderer);
};

var TAAGLSLCode = "\n@export car.taa\n#define SHADER_NAME TAA\n#define FLT_EPS 0.00000001\n#define MINMAX_3X3\n#define USE_CLIPPING\n#define USE_DILATION\nuniform sampler2D prevTex;\nuniform sampler2D currTex;\nuniform sampler2D velocityTex;\nuniform sampler2D depthTex;\nuniform bool still;\nuniform float sinTime;\nuniform float motionScale;\nuniform float feedbackMin: 0.88;\nuniform float feedbackMax: 0.97;\nuniform mat4 projection;\nuniform vec2 texelSize;\nuniform vec2 depthTexelSize;\nvarying vec2 v_Texcoord;\nconst vec3 w = vec3(0.2125, 0.7154, 0.0721);\nfloat depth_resolve_linear(float depth) {\n if (projection[3][3] == 0.0) {\n return projection[3][2] / (depth * projection[2][3] - projection[2][2]);\n }\n else {\n return (depth - projection[3][2]) / projection[2][2];\n }\n}\nvec3 find_closest_fragment_3x3(vec2 uv)\n{\n\tvec2 dd = abs(depthTexelSize.xy);\n\tvec2 du = vec2(dd.x, 0.0);\n\tvec2 dv = vec2(0.0, dd.y);\n\tvec3 dtl = vec3(-1, -1, texture2D(depthTex, uv - dv - du).x);\n\tvec3 dtc = vec3( 0, -1, texture2D(depthTex, uv - dv).x);\n\tvec3 dtr = vec3( 1, -1, texture2D(depthTex, uv - dv + du).x);\n\tvec3 dml = vec3(-1, 0, texture2D(depthTex, uv - du).x);\n\tvec3 dmc = vec3( 0, 0, texture2D(depthTex, uv).x);\n\tvec3 dmr = vec3( 1, 0, texture2D(depthTex, uv + du).x);\n\tvec3 dbl = vec3(-1, 1, texture2D(depthTex, uv + dv - du).x);\n\tvec3 dbc = vec3( 0, 1, texture2D(depthTex, uv + dv).x);\n\tvec3 dbr = vec3( 1, 1, texture2D(depthTex, uv + dv + du).x);\n\tvec3 dmin = dtl;\n\tif (dmin.z > dtc.z) dmin = dtc;\n\tif (dmin.z > dtr.z) dmin = dtr;\n\tif (dmin.z > dml.z) dmin = dml;\n\tif (dmin.z > dmc.z) dmin = dmc;\n\tif (dmin.z > dmr.z) dmin = dmr;\n\tif (dmin.z > dbl.z) dmin = dbl;\n\tif (dmin.z > dbc.z) dmin = dbc;\n\tif (dmin.z > dbr.z) dmin = dbr;\n\treturn vec3(uv + dd.xy * dmin.xy, dmin.z);\n}\nfloat PDnrand( vec2 n ) {\n\treturn fract( sin(dot(n.xy, vec2(12.9898, 78.233)))* 43758.5453 );\n}\nvec2 PDnrand2( vec2 n ) {\n\treturn fract( sin(dot(n.xy, vec2(12.9898, 78.233)))* vec2(43758.5453, 28001.8384) );\n}\nvec3 PDnrand3( vec2 n ) {\n\treturn fract( sin(dot(n.xy, vec2(12.9898, 78.233)))* vec3(43758.5453, 28001.8384, 50849.4141 ) );\n}\nvec4 PDnrand4( vec2 n ) {\n\treturn fract( sin(dot(n.xy, vec2(12.9898, 78.233)))* vec4(43758.5453, 28001.8384, 50849.4141, 12996.89) );\n}\nfloat PDsrand( vec2 n ) {\n\treturn PDnrand( n ) * 2.0 - 1.0;\n}\nvec2 PDsrand2( vec2 n ) {\n\treturn PDnrand2( n ) * 2.0 - 1.0;\n}\nvec3 PDsrand3( vec2 n ) {\n\treturn PDnrand3( n ) * 2.0 - 1.0;\n}\nvec4 PDsrand4( vec2 n ) {\n\treturn PDnrand4( n ) * 2.0 - 1.0;\n}\nvec3 RGB_YCoCg(vec3 c)\n{\n return vec3(\n c.x/4.0 + c.y/2.0 + c.z/4.0,\n c.x/2.0 - c.z/2.0,\n -c.x/4.0 + c.y/2.0 - c.z/4.0\n );\n}\nvec3 YCoCg_RGB(vec3 c)\n{\n return clamp(vec3(\n c.x + c.y - c.z,\n c.x + c.z,\n c.x - c.y - c.z\n ), vec3(0.0), vec3(1.0));\n}\nvec4 sample_color(sampler2D tex, vec2 uv)\n{\n#ifdef USE_YCOCG\n vec4 c = texture2D(tex, uv);\n return vec4(RGB_YCoCg(c.rgb), c.a);\n#else\n return texture2D(tex, uv);\n#endif\n}\nvec4 resolve_color(vec4 c)\n{\n#ifdef USE_YCOCG\n return vec4(YCoCg_RGB(c.rgb).rgb, c.a);\n#else\n return c;\n#endif\n}\nvec4 clip_aabb(vec3 aabb_min, vec3 aabb_max, vec4 p, vec4 q)\n{\n vec4 r = q - p;\n vec3 rmax = aabb_max - p.xyz;\n vec3 rmin = aabb_min - p.xyz;\n const float eps = FLT_EPS;\n if (r.x > rmax.x + eps)\n r *= (rmax.x / r.x);\n if (r.y > rmax.y + eps)\n r *= (rmax.y / r.y);\n if (r.z > rmax.z + eps)\n r *= (rmax.z / r.z);\n if (r.x < rmin.x - eps)\n r *= (rmin.x / r.x);\n if (r.y < rmin.y - eps)\n r *= (rmin.y / r.y);\n if (r.z < rmin.z - eps)\n r *= (rmin.z / r.z);\n return p + r;\n}\nvec4 sample_color_motion(sampler2D tex, vec2 uv, vec2 ss_vel)\n{\n vec2 v = 0.5 * ss_vel;\n float srand = PDsrand(uv + vec2(sinTime));\n vec2 vtap = v / 3.0;\n vec2 pos0 = uv + vtap * (0.5 * srand);\n vec4 accu = vec4(0.0);\n float wsum = 0.0;\n for (int i = -3; i <= 3; i++)\n {\n float w = 1.0; accu += w * sample_color(tex, pos0 + float(i) * vtap);\n wsum += w;\n }\n return accu / wsum;\n}\nvec4 temporal_reprojection(vec2 ss_txc, vec2 ss_vel, float vs_dist)\n{\n vec4 texel0 = sample_color(currTex, ss_txc);\n vec4 texel1 = sample_color(prevTex, ss_txc - ss_vel);\n vec2 uv = v_Texcoord;\n#if defined(MINMAX_3X3) || defined(MINMAX_3X3_ROUNDED)\n vec2 du = vec2(texelSize.x, 0.0);\n vec2 dv = vec2(0.0, texelSize.y);\n vec4 ctl = sample_color(currTex, uv - dv - du);\n vec4 ctc = sample_color(currTex, uv - dv);\n vec4 ctr = sample_color(currTex, uv - dv + du);\n vec4 cml = sample_color(currTex, uv - du);\n vec4 cmc = sample_color(currTex, uv);\n vec4 cmr = sample_color(currTex, uv + du);\n vec4 cbl = sample_color(currTex, uv + dv - du);\n vec4 cbc = sample_color(currTex, uv + dv);\n vec4 cbr = sample_color(currTex, uv + dv + du);\n vec4 cmin = min(ctl, min(ctc, min(ctr, min(cml, min(cmc, min(cmr, min(cbl, min(cbc, cbr))))))));\n vec4 cmax = max(ctl, max(ctc, max(ctr, max(cml, max(cmc, max(cmr, max(cbl, max(cbc, cbr))))))));\n #if defined(MINMAX_3X3_ROUNDED) || defined(USE_YCOCG) || defined(USE_CLIPPING)\n vec4 cavg = (ctl + ctc + ctr + cml + cmc + cmr + cbl + cbc + cbr) / 9.0;\n #endif\n #ifdef MINMAX_3X3_ROUNDED\n vec4 cmin5 = min(ctc, min(cml, min(cmc, min(cmr, cbc))));\n vec4 cmax5 = max(ctc, max(cml, max(cmc, max(cmr, cbc))));\n vec4 cavg5 = (ctc + cml + cmc + cmr + cbc) / 5.0;\n cmin = 0.5 * (cmin + cmin5);\n cmax = 0.5 * (cmax + cmax5);\n cavg = 0.5 * (cavg + cavg5);\n #endif\n#elif defined(MINMAX_4TAP_VARYING)\n const float _SubpixelThreshold = 0.5;\n const float _GatherBase = 0.5;\n const float _GatherSubpixelMotion = 0.1666;\n vec2 texel_vel = ss_vel / depthTexelSize.xy;\n float texel_vel_mag = length(texel_vel) * vs_dist;\n float k_subpixel_motion = saturate(_SubpixelThreshold / (FLT_EPS + texel_vel_mag));\n float k_min_max_support = _GatherBase + _GatherSubpixelMotion * k_subpixel_motion;\n vec2 ss_offset01 = k_min_max_support * vec2(-texelSize.x, texelSize.y);\n vec2 ss_offset11 = k_min_max_support * vec2(texelSize.x, texelSize.y);\n vec4 c00 = sample_color(currTex, uv - ss_offset11);\n vec4 c10 = sample_color(currTex, uv - ss_offset01);\n vec4 c01 = sample_color(currTex, uv + ss_offset01);\n vec4 c11 = sample_color(currTex, uv + ss_offset11);\n vec4 cmin = min(c00, min(c10, min(c01, c11)));\n vec4 cmax = max(c00, max(c10, max(c01, c11)));\n #ifdef USE_YCOCG || USE_CLIPPING\n vec4 cavg = (c00 + c10 + c01 + c11) / 4.0;\n #endif\n#endif\n#ifdef USE_YCOCG\n vec2 chroma_extent = vec2(0.25 * 0.5 * (cmax.r - cmin.r));\n vec2 chroma_center = texel0.gb;\n cmin.yz = chroma_center - chroma_extent;\n cmax.yz = chroma_center + chroma_extent;\n cavg.yz = chroma_center;\n#endif\n#ifdef USE_CLIPPING\n texel1 = clip_aabb(cmin.xyz, cmax.xyz, clamp(cavg, cmin, cmax), texel1);\n#else\n texel1 = clamp(texel1, cmin, cmax);\n#endif\n#ifdef USE_YCOCG\n float lum0 = texel0.r;\n float lum1 = texel1.r;\n#else\n float lum0 = dot(texel0.rgb, w);\n float lum1 = dot(texel1.rgb, w);\n#endif\n float unbiased_diff = abs(lum0 - lum1) / max(lum0, max(lum1, 0.2));\n float unbiased_weight = 1.0 - unbiased_diff;\n float unbiased_weight_sqr = unbiased_weight * unbiased_weight;\n float k_feedback = mix(feedbackMin, feedbackMax, unbiased_weight_sqr);\n return mix(texel0, texel1, k_feedback);\n}\nvoid main()\n{\n vec2 uv = v_Texcoord;\n if (still) {\n gl_FragColor = mix(texture2D(currTex, uv), texture2D(prevTex, uv), 0.9);\n return;\n }\n#ifdef USE_DILATION\n vec3 c_frag = find_closest_fragment_3x3(uv);\n vec2 ss_vel = texture2D(velocityTex, c_frag.xy).xy;\n float vs_dist = depth_resolve_linear(c_frag.z);\n#else\n vec2 ss_vel = texture2D(velocityTex, uv).xy;\n float vs_dist = depth_sample_linear(uv);\n#endif\n vec4 color_temporal = temporal_reprojection(v_Texcoord, ss_vel, vs_dist);\n vec4 to_buffer = resolve_color(color_temporal);\n vec4 noise4 = PDsrand4(v_Texcoord + sinTime + 0.6959174) / 510.0;\n gl_FragColor = clamp(to_buffer + noise4, vec4(0.0), vec4(1.0));\n}\n@end\n";

// Temporal Super Sample for static Scene
var Pass$2 = claygl.compositor.Pass;

claygl.Shader.import(TAAGLSLCode);

function TemporalSuperSampling (opt) {
    opt = opt || {};
    var haltonSequence = [];

    for (var i = 0; i < 30; i++) {
        haltonSequence.push([
            halton(i, 2), halton(i, 3)
        ]);
    }

    this._haltonSequence = haltonSequence;

    this._frame = 0;

    this._sourceTex = new claygl.Texture2D();
    this._sourceFb = new claygl.FrameBuffer();
    this._sourceFb.attach(this._sourceTex);

    // Frame texture before temporal supersampling
    this._prevFrameTex = new claygl.Texture2D();
    this._outputTex = new claygl.Texture2D();

    var taaPass = this._taaPass = new Pass$2({
        fragment: claygl.Shader.source('car.taa')
    });
    taaPass.setUniform('velocityTex', opt.velocityTexture);
    taaPass.setUniform('depthTex', opt.depthTexture);

    this._depthTex = opt.depthTexture;

    this._taaFb = new claygl.FrameBuffer({
        depthBuffer: false
    });

    this._outputPass = new Pass$2({
        fragment: claygl.Shader.source('clay.compositor.output'),
        // TODO, alpha is premultiplied?
        blendWithPrevious: true
    });
    this._outputPass.material.define('fragment', 'OUTPUT_ALPHA');
    this._outputPass.material.blend = function (_gl) {
        // FIXME.
        // Output is premultiplied alpha when BLEND is enabled ?
        // http://stackoverflow.com/questions/2171085/opengl-blending-with-previous-contents-of-framebuffer
        _gl.blendEquationSeparate(_gl.FUNC_ADD, _gl.FUNC_ADD);
        _gl.blendFuncSeparate(_gl.ONE, _gl.ONE_MINUS_SRC_ALPHA, _gl.ONE, _gl.ONE_MINUS_SRC_ALPHA);
    };
}

TemporalSuperSampling.prototype = {

    constructor: TemporalSuperSampling,

    /**
     * Jitter camera projectionMatrix
     * @parma {clay.Renderer} renderer
     * @param {clay.Camera} camera
     */
    jitterProjection: function (renderer, camera$$1) {
        var viewport = renderer.viewport;
        var dpr = viewport.devicePixelRatio || renderer.getDevicePixelRatio();
        var width = viewport.width * dpr;
        var height = viewport.height * dpr;

        var offset = this._haltonSequence[this._frame % this._haltonSequence.length];

        var translationMat = new claygl.Matrix4();
        translationMat.array[12] = (offset[0] * 2.0 - 1.0) / width;
        translationMat.array[13] = (offset[1] * 2.0 - 1.0) / height;

        claygl.Matrix4.mul(camera$$1.projectionMatrix, translationMat, camera$$1.projectionMatrix);

        claygl.Matrix4.invert(camera$$1.invProjectionMatrix, camera$$1.projectionMatrix);
    },

    /**
     * Reset accumulating frame
     */
    resetFrame: function () {
        this._frame = 0;
    },

    /**
     * Return current frame
     */
    getFrame: function () {
        return this._frame;
    },

    /**
     * Get source framebuffer for usage
     */
    getSourceFrameBuffer: function () {
        return this._sourceFb;
    },

    resize: function (width, height) {
        if (this._sourceTex.width !== width || this._sourceTex.height !== height) {

            this._prevFrameTex.width = width;
            this._prevFrameTex.height = height;

            this._outputTex.width = width;
            this._outputTex.height = height;

            this._sourceTex.width = width;
            this._sourceTex.height = height;

            this._prevFrameTex.dirty();
            this._outputTex.dirty();
            this._sourceTex.dirty();
        }
    },

    isFinished: function () {
        return this._frame >= this._haltonSequence.length;
    },

    render: function (renderer, camera$$1, still) {
        var taaPass = this._taaPass;
        // if (this._frame === 0) {
        //     // Direct output
        //     taaPass.setUniform('weight1', 0);
        //     taaPass.setUniform('weight2', 1);
        // }
        // else {
        // taaPass.setUniform('weight1', 0.9);
        // taaPass.setUniform('weight2', 0.1);
        // }
        taaPass.setUniform('prevTex', this._prevFrameTex);
        taaPass.setUniform('currTex', this._sourceTex);
        taaPass.setUniform('texelSize', [1 / this._sourceTex.width, 1 / this._sourceTex.width]);
        taaPass.setUniform('depthTexelSize', [1 / this._depthTex.width, 1 / this._depthTex.width]);
        taaPass.setUniform('sinTime', Math.sin(+(new Date()) / 8));
        taaPass.setUniform('projection', camera$$1.projectionMatrix.array);

        taaPass.setUniform('still', !!still);

        this._taaFb.attach(this._outputTex);
        this._taaFb.bind(renderer);
        taaPass.render(renderer);
        this._taaFb.unbind(renderer);

        this._outputPass.setUniform('texture', this._outputTex);
        this._outputPass.render(renderer);

        // Swap texture
        var tmp = this._prevFrameTex;
        this._prevFrameTex = this._outputTex;
        this._outputTex = tmp;

        this._frame++;
    },

    dispose: function (renderer) {
        this._sourceFb.dispose(renderer);
        this._taaFb.dispose(renderer);
        this._prevFrameTex.dispose(renderer);
        this._outputTex.dispose(renderer);
        this._sourceTex.dispose(renderer);
        this._outputPass.dispose(renderer);
        this._taaPass.dispose(renderer);
    }
};

var ShadowMapPass = claygl.prePass.ShadowMap;
var PerspectiveCamera = claygl.camera.Perspective;

function RenderMain(renderer, scene, enableShadow) {

    this.renderer = renderer;
    this.scene = scene;

    this.preZ = false;

    this._compositor = new EffectCompositor();

    this._temporalSS = new TemporalSuperSampling({
        velocityTexture: this._compositor.getVelocityTexture(),
        depthTexture: this._compositor.getDepthTexture()
    });

    if (enableShadow) {
        this._shadowMapPass = new ShadowMapPass({
            lightFrustumBias: 20
        });
    }

    this._enableTemporalSS = 'auto';

    scene.on('beforerender', function (renderer, scene, camera$$1) {
        if (this.needsTemporalSS()) {
            this._temporalSS.jitterProjection(renderer, camera$$1);
        }
    }, this);
}

/**
 * Cast a ray
 * @param {number} x offsetX
 * @param {number} y offsetY
 * @param {clay.math.Ray} out
 * @return {clay.math.Ray}
 */
var ndc = new claygl.Vector2();
RenderMain.prototype.castRay = function (x, y, out) {
    var renderer = this.layer.renderer;

    var oldViewport = renderer.viewport;
    renderer.viewport = this.viewport;
    renderer.screenToNDC(x, y, ndc);
    this.camera.castRay(ndc, out);
    renderer.viewport = oldViewport;

    return out;
};

/**
 * Prepare and update scene before render
 */
RenderMain.prototype.prepareRender = function () {
    var scene = this.scene;
    var camera$$1 = scene.getMainCamera();
    var renderer = this.renderer;

    camera$$1.aspect = renderer.getViewportAspect();

    scene.update();
    scene.updateLights();
    var renderList = scene.updateRenderList(camera$$1);

    this._updateSRGBOfList(renderList.opaque);
    this._updateSRGBOfList(renderList.transparent);

    this._frame = 0;
    // this._temporalSS.resetFrame();

    var lights = scene.getLights();
    for (var i = 0; i < lights.length; i++) {
        if (lights[i].cubemap) {
            if (this._compositor && this._compositor.isSSREnabled()) {
                lights[i].invisible = true;
            }
            else {
                lights[i].invisible = false;
            }
        }
    }

    if (this._enablePostEffect) {
        this._compositor.resize(renderer.getWidth(), renderer.getHeight(), renderer.getDevicePixelRatio());
        this._temporalSS.resize(renderer.getWidth(), renderer.getHeight());
    }
};

RenderMain.prototype.render = function (accumulating) {
    var scene = this.scene;
    var camera$$1 = scene.getMainCamera();
    this._doRender(scene, camera$$1, accumulating, this._frame);
    this._frame++;
};

RenderMain.prototype.needsAccumulate = function () {
    return this.needsTemporalSS() || this._needsSortProgressively;
};

RenderMain.prototype.needsTemporalSS = function () {
    var enableTemporalSS = this._enableTemporalSS;
    if (enableTemporalSS === 'auto') {
        enableTemporalSS = this._enablePostEffect;
    }
    return enableTemporalSS;
};

RenderMain.prototype.hasDOF = function () {
    return this._enableDOF;
};

RenderMain.prototype.isAccumulateFinished = function () {
    var frame = this._frame;
    return !(this.needsTemporalSS() && !this._temporalSS.isFinished(frame))
        && !(this._compositor && !this._compositor.isSSAOFinished(frame))
        && !(this._compositor && !this._compositor.isSSRFinished(frame))
        && !(this._compositor && frame < 30);
};

RenderMain.prototype._doRender = function (scene, camera$$1, accumulating, accumFrame) {

    var renderer = this.renderer;

    accumFrame = accumFrame || 0;

    if (!accumulating && this._shadowMapPass) {
        this._shadowMapPass.kernelPCF = this._pcfKernels[0];
        // Not render shadowmap pass in accumulating frame.
        this._shadowMapPass.render(renderer, scene, camera$$1, true);
    }

    this._updateShadowPCFKernel(scene, camera$$1, accumFrame);

    // Shadowmap will set clearColor.
    renderer.gl.clearColor(0.0, 0.0, 0.0, 0.0);

    if (this._enablePostEffect) {
        // normal render also needs to be jittered when have edge pass.
        if (this.needsTemporalSS()) {
            this._temporalSS.jitterProjection(renderer, camera$$1);
        }
        this._compositor.updateGBuffer(renderer, scene, camera$$1, this._temporalSS.getFrame());
    }

    // Always update SSAO to make sure have correct ssaoMap status
    // TODO TRANSPARENT OBJECTS.
    this._updateSSAO(renderer, scene, camera$$1, this._temporalSS.getFrame());

    var frameBuffer;
    if (this._enablePostEffect) {

        frameBuffer = this._compositor.getSourceFrameBuffer();
        frameBuffer.bind(renderer);
        renderer.gl.clear(renderer.gl.DEPTH_BUFFER_BIT | renderer.gl.COLOR_BUFFER_BIT);
        // FIXME Enable pre z will make alpha test failed
        renderer.render(scene, camera$$1, true, this.preZ);
        this.afterRenderScene(renderer, scene, camera$$1);
        frameBuffer.unbind(renderer);

        if (this.needsTemporalSS()) {
            this._compositor.composite(renderer, scene, camera$$1, this._temporalSS.getSourceFrameBuffer(), this._temporalSS.getFrame());
            this._temporalSS.render(renderer, camera$$1, accumulating);
        }
        else {
            this._compositor.composite(renderer, scene, camera$$1, null, 0);
        }
    }
    else {
        if (this.needsTemporalSS()) {
            frameBuffer = this._temporalSS.getSourceFrameBuffer();
            frameBuffer.bind(renderer);
            renderer.saveClear();
            renderer.clearBit = renderer.gl.DEPTH_BUFFER_BIT | renderer.gl.COLOR_BUFFER_BIT;
            renderer.render(scene, camera$$1, true, this.preZ);
            this.afterRenderScene(renderer, scene, camera$$1);
            renderer.restoreClear();
            frameBuffer.unbind(renderer);
            this._temporalSS.render(renderer, camera$$1, accumulating);
        }
        else {
            renderer.render(scene, camera$$1, true, this.preZ);
            this.afterRenderScene(renderer, scene, camera$$1);
        }
    }

    this.afterRenderAll(renderer, scene, camera$$1);
};

RenderMain.prototype._updateSRGBOfList = function (list) {
    var isLinearSpace = this.isLinearSpace();
    for (var i = 0; i < list.length; i++) {
        list[i].material[isLinearSpace ? 'define' : 'undefine']('fragment', 'SRGB_DECODE');
    }
};

RenderMain.prototype.afterRenderScene = function (renderer, scene, camera$$1) {};
RenderMain.prototype.afterRenderAll = function (renderer, scene, camera$$1) {};

RenderMain.prototype._updateSSAO = function (renderer, scene, camera$$1, frame) {
    var ifEnableSSAO = this._enableSSAO && this._enablePostEffect;
    var compositor$$1 = this._compositor;
    if (ifEnableSSAO) {
        this._compositor.updateSSAO(renderer, scene, camera$$1, this._temporalSS.getFrame());
    }

    function updateQueue(queue) {
        for (var i = 0; i < queue.length; i++) {
            var renderable = queue[i];
            renderable.material[ifEnableSSAO ? 'enableTexture' : 'disableTexture']('ssaoMap');
            if (ifEnableSSAO) {
                renderable.material.set('ssaoMap', compositor$$1.getSSAOTexture());
            }
        }
    }
    updateQueue(scene.getRenderList(camera$$1).opaque);
    updateQueue(scene.getRenderList(camera$$1).transparent);
};

RenderMain.prototype._updateShadowPCFKernel = function (scene, camera$$1, frame) {
    var pcfKernel = this._pcfKernels[frame % this._pcfKernels.length];
    function updateQueue(queue) {
        for (var i = 0; i < queue.length; i++) {
            if (queue[i].receiveShadow) {
                queue[i].material.set('pcfKernel', pcfKernel);
                if (queue[i].material) {
                    queue[i].material.define('fragment', 'PCF_KERNEL_SIZE', pcfKernel.length / 2);
                }
            }
        }
    }
    updateQueue(scene.getRenderList(camera$$1).opaque);
    updateQueue(scene.getRenderList(camera$$1).transparent);
};

RenderMain.prototype.dispose = function () {
    var renderer = this.renderer;
    this._compositor.dispose(renderer);
    this._temporalSS.dispose(renderer);
    if (this._shadowMapPass) {
        this._shadowMapPass.dispose(renderer);
    }
    renderer.dispose();
};

RenderMain.prototype.setPostEffect = function (opts, api) {
    var compositor$$1 = this._compositor;
    opts = opts || {};
    this._enablePostEffect = !!opts.enable;
    var bloomOpts = opts.bloom || {};
    var edgeOpts = opts.edge || {};
    var dofOpts = opts.depthOfField || {};
    var ssaoOpts = opts.screenSpaceAmbientOcclusion || {};
    var ssrOpts = opts.screenSpaceReflection || {};
    var fxaaOpts = opts.FXAA || {};
    var colorCorrOpts = opts.colorCorrection || {};
    bloomOpts.enable ? compositor$$1.enableBloom() : compositor$$1.disableBloom();
    dofOpts.enable ? compositor$$1.enableDOF() : compositor$$1.disableDOF();
    ssrOpts.enable ? compositor$$1.enableSSR() : compositor$$1.disableSSR();
    colorCorrOpts.enable ? compositor$$1.enableColorCorrection() : compositor$$1.disableColorCorrection();
    edgeOpts.enable ? compositor$$1.enableEdge() : compositor$$1.disableEdge();
    fxaaOpts.enable ? compositor$$1.enableFXAA() : compositor$$1.disableFXAA();

    this._enableDOF = dofOpts.enable;
    this._enableSSAO = ssaoOpts.enable;

    this._enableSSAO ? compositor$$1.enableSSAO() : compositor$$1.disableSSAO();

    compositor$$1.setBloomIntensity(bloomOpts.intensity);
    compositor$$1.setEdgeColor(edgeOpts.color);
    compositor$$1.setColorLookupTexture(colorCorrOpts.lookupTexture, api);
    compositor$$1.setExposure(colorCorrOpts.exposure);

    ['radius', 'quality', 'intensity'].forEach(function (name) {
        compositor$$1.setSSAOParameter(name, ssaoOpts[name]);
    });
    ['quality', 'maxRoughness', 'physical'].forEach(function (name) {
        compositor$$1.setSSRParameter(name, ssrOpts[name]);
    });
    ['quality', 'focalDistance', 'focalRange', 'blurRadius', 'fstop'].forEach(function (name) {
        compositor$$1.setDOFParameter(name, dofOpts[name]);
    });
    ['brightness', 'contrast', 'saturation'].forEach(function (name) {
        compositor$$1.setColorCorrection(name, colorCorrOpts[name]);
    });
};

RenderMain.prototype.setShadow = function (opts) {
    var pcfKernels = [];
    var off = 0;
    for (var i = 0; i < 30; i++) {
        var pcfKernel = [];
        for (var k = 0; k < opts.kernelSize; k++) {
            pcfKernel.push((halton(off, 2) * 2.0 - 1.0) * opts.blurSize);
            pcfKernel.push((halton(off, 3) * 2.0 - 1.0) * opts.blurSize);
            off++;
        }
        pcfKernels.push(pcfKernel);
    }
    this._pcfKernels = pcfKernels;
};

RenderMain.prototype.isDOFEnabled = function () {
    return this._enablePostEffect && this._enableDOF;
};

RenderMain.prototype.setDOFFocusOnPoint = function (depth) {
    if (this._enablePostEffect) {

        if (depth > this.camera.far || depth < this.camera.near) {
            return;
        }

        this._compositor.setDOFParameter('focalDistance', depth);
        return true;
    }
};

RenderMain.prototype.setTemporalSuperSampling = function (temporalSuperSamplingOpt) {
    temporalSuperSamplingOpt = temporalSuperSamplingOpt || {};
    this._enableTemporalSS = temporalSuperSamplingOpt.enable;
};

RenderMain.prototype.isLinearSpace = function () {
    return this._enablePostEffect;
};

var defaultGraphicConfig = {
    // If enable shadow
    shadow: {
        enable: true,
        kernelSize: 6,
        blurSize: 2
    },

    // Configuration about post effects.
    postEffect: {
        // If enable post effects.
        enable: true,
        // Configuration about bloom post effect
        bloom: {
            // If enable bloom
            enable: true,
            // Intensity of bloom
            intensity: 0.1
        },
        // Configuration about depth of field
        depthOfField: {
            enable: false,
            // Focal distance of camera in word space.
            focalDistance: 5,
            // Focal range of camera in word space. in this range image will be absolutely sharp.
            focalRange: 1,
            // Max out of focus blur radius.
            blurRadius: 5,
            // fstop of camera. Smaller fstop will have shallow depth of field
            fstop: 2.8,
            // Blur quality. 'low'|'medium'|'high'|'ultra'
            quality: 'medium'
        },
        // Configuration about screen space ambient occulusion
        screenSpaceAmbientOcclusion: {
            // If enable SSAO
            enable: false,
            // Sampling radius in work space.
            // Larger will produce more soft concat shadow.
            // But also needs higher quality or it will have more obvious artifacts
            radius: 0.2,
            // Quality of SSAO. 'low'|'medium'|'high'|'ultra'
            quality: 'medium',
            // Intensity of SSAO
            intensity: 1
        },
        // Configuration about screen space reflection
        screenSpaceReflection: {
            enable: false,
            // If physically corrected.
            physical: false,
            // Quality of SSR. 'low'|'medium'|'high'|'ultra'
            quality: 'medium',
            // Surface with less roughness will have reflection.
            maxRoughness: 0.8
        },
        // Configuration about color correction
        colorCorrection: {
            // If enable color correction
            enable: true,
            exposure: 0,
            brightness: 0,
            contrast: 1,
            saturation: 1,
            // Lookup texture for color correction.
            // See https://ecomfe.github.io/echarts-doc/public/cn/option-gl.html#globe.postEffect.colorCorrection.lookupTexture
            lookupTexture: ''
        },
        FXAA: {
            // If enable FXAA
            enable: false
        }
    }
};

/**
 * @module zrender/core/util
 */

// 用于处理merge时无法遍历Date等对象的问题
var BUILTIN_OBJECT = {
    '[object Function]': 1,
    '[object RegExp]': 1,
    '[object Date]': 1,
    '[object Error]': 1,
    '[object CanvasGradient]': 1,
    '[object CanvasPattern]': 1,
    // For node-canvas
    '[object Image]': 1,
    '[object Canvas]': 1
};

var TYPED_ARRAY = {
    '[object Int8Array]': 1,
    '[object Uint8Array]': 1,
    '[object Uint8ClampedArray]': 1,
    '[object Int16Array]': 1,
    '[object Uint16Array]': 1,
    '[object Int32Array]': 1,
    '[object Uint32Array]': 1,
    '[object Float32Array]': 1,
    '[object Float64Array]': 1
};

var objToString = Object.prototype.toString;



/**
 * Those data types can be cloned:
 *     Plain object, Array, TypedArray, number, string, null, undefined.
 * Those data types will be assgined using the orginal data:
 *     BUILTIN_OBJECT
 * Instance of user defined class will be cloned to a plain object, without
 * properties in prototype.
 * Other data types is not supported (not sure what will happen).
 *
 * Caution: do not support clone Date, for performance consideration.
 * (There might be a large number of date in `series.data`).
 * So date should not be modified in and out of echarts.
 *
 * @param {*} source
 * @return {*} new
 */
function clone(source) {
    if (source == null || typeof source != 'object') {
        return source;
    }

    var result = source;
    var typeStr = objToString.call(source);

    if (typeStr === '[object Array]') {
        if (!isPrimitive(source)) {
            result = [];
            for (var i = 0, len = source.length; i < len; i++) {
                result[i] = clone(source[i]);
            }
        }
    }
    else if (TYPED_ARRAY[typeStr]) {
        if (!isPrimitive(source)) {
            var Ctor = source.constructor;
            if (source.constructor.from) {
                result = Ctor.from(source);
            }
            else {
                result = new Ctor(source.length);
                for (var i = 0, len = source.length; i < len; i++) {
                    result[i] = clone(source[i]);
                }
            }
        }
    }
    else if (!BUILTIN_OBJECT[typeStr] && !isPrimitive(source) && !isDom(source)) {
        result = {};
        for (var key in source) {
            if (source.hasOwnProperty(key)) {
                result[key] = clone(source[key]);
            }
        }
    }

    return result;
}

/**
 * @memberOf module:zrender/core/util
 * @param {*} target
 * @param {*} source
 * @param {boolean} [overwrite=false]
 */
function merge(target, source, overwrite) {
    // We should escapse that source is string
    // and enter for ... in ...
    if (!isObject(source) || !isObject(target)) {
        return overwrite ? clone(source) : target;
    }

    for (var key in source) {
        if (source.hasOwnProperty(key)) {
            var targetProp = target[key];
            var sourceProp = source[key];

            if (isObject(sourceProp)
                && isObject(targetProp)
                && !isArray(sourceProp)
                && !isArray(targetProp)
                && !isDom(sourceProp)
                && !isDom(targetProp)
                && !isBuiltInObject(sourceProp)
                && !isBuiltInObject(targetProp)
                && !isPrimitive(sourceProp)
                && !isPrimitive(targetProp)
            ) {
                // 如果需要递归覆盖，就递归调用merge
                merge(targetProp, sourceProp, overwrite);
            }
            else if (overwrite || !(key in target)) {
                // 否则只处理overwrite为true，或者在目标对象中没有此属性的情况
                // NOTE，在 target[key] 不存在的时候也是直接覆盖
                target[key] = clone(source[key], true);
            }
        }
    }

    return target;
}

/**
 * @param {Array} targetAndSources The first item is target, and the rests are source.
 * @param {boolean} [overwrite=false]
 * @return {*} target
 */


/**
 * @param {*} target
 * @param {*} source
 * @memberOf module:zrender/core/util
 */


/**
 * @param {*} target
 * @param {*} source
 * @param {boolean} [overlay=false]
 * @memberOf module:zrender/core/util
 */






/**
 * 查询数组中元素的index
 * @memberOf module:zrender/core/util
 */


/**
 * 构造类继承关系
 *
 * @memberOf module:zrender/core/util
 * @param {Function} clazz 源类
 * @param {Function} baseClazz 基类
 */


/**
 * @memberOf module:zrender/core/util
 * @param {Object|Function} target
 * @param {Object|Function} sorce
 * @param {boolean} overlay
 */


/**
 * Consider typed array.
 * @param {Array|TypedArray} data
 */


/**
 * 数组或对象遍历
 * @memberOf module:zrender/core/util
 * @param {Object|Array} obj
 * @param {Function} cb
 * @param {*} [context]
 */


/**
 * 数组映射
 * @memberOf module:zrender/core/util
 * @param {Array} obj
 * @param {Function} cb
 * @param {*} [context]
 * @return {Array}
 */


/**
 * @memberOf module:zrender/core/util
 * @param {Array} obj
 * @param {Function} cb
 * @param {Object} [memo]
 * @param {*} [context]
 * @return {Array}
 */


/**
 * 数组过滤
 * @memberOf module:zrender/core/util
 * @param {Array} obj
 * @param {Function} cb
 * @param {*} [context]
 * @return {Array}
 */


/**
 * 数组项查找
 * @memberOf module:zrender/core/util
 * @param {Array} obj
 * @param {Function} cb
 * @param {*} [context]
 * @return {*}
 */


/**
 * @memberOf module:zrender/core/util
 * @param {Function} func
 * @param {*} context
 * @return {Function}
 */


/**
 * @memberOf module:zrender/core/util
 * @param {Function} func
 * @return {Function}
 */


/**
 * @memberOf module:zrender/core/util
 * @param {*} value
 * @return {boolean}
 */
function isArray(value) {
    return objToString.call(value) === '[object Array]';
}

/**
 * @memberOf module:zrender/core/util
 * @param {*} value
 * @return {boolean}
 */


/**
 * @memberOf module:zrender/core/util
 * @param {*} value
 * @return {boolean}
 */


/**
 * @memberOf module:zrender/core/util
 * @param {*} value
 * @return {boolean}
 */
function isObject(value) {
    // Avoid a V8 JIT bug in Chrome 19-20.
    // See https://code.google.com/p/v8/issues/detail?id=2291 for more details.
    var type = typeof value;
    return type === 'function' || (!!value && type == 'object');
}

/**
 * @memberOf module:zrender/core/util
 * @param {*} value
 * @return {boolean}
 */
function isBuiltInObject(value) {
    return !!BUILTIN_OBJECT[objToString.call(value)];
}

/**
 * @memberOf module:zrender/core/util
 * @param {*} value
 * @return {boolean}
 */


/**
 * @memberOf module:zrender/core/util
 * @param {*} value
 * @return {boolean}
 */
function isDom(value) {
    return typeof value === 'object'
        && typeof value.nodeType === 'number'
        && typeof value.ownerDocument === 'object';
}

/**
 * Whether is exactly NaN. Notice isNaN('a') returns true.
 * @param {*} value
 * @return {boolean}
 */


/**
 * If value1 is not null, then return value1, otherwise judget rest of values.
 * Low performance.
 * @memberOf module:zrender/core/util
 * @return {*} Final value
 */






/**
 * @memberOf module:zrender/core/util
 * @param {Array} arr
 * @param {number} startIndex
 * @param {number} endIndex
 * @return {Array}
 */


/**
 * Normalize css liked array configuration
 * e.g.
 *  3 => [3, 3, 3, 3]
 *  [4, 2] => [4, 2, 4, 2]
 *  [4, 3, 2] => [4, 3, 2, 3]
 * @param {number|Array.<number>} val
 * @return {Array.<number>}
 */


/**
 * @memberOf module:zrender/core/util
 * @param {boolean} condition
 * @param {string} message
 */


/**
 * @memberOf module:zrender/core/util
 * @param {string} str string to be trimed
 * @return {string} trimed string
 */


var primitiveKey = '__ec_primitive__';
/**
 * Set an object as primitive to be ignored traversing children in clone or merge
 */


function isPrimitive(obj) {
    return obj[primitiveKey];
}

function ClayAdvancedRenderer(renderer, scene, timeline, graphicOpts) {
    graphicOpts = merge({}, graphicOpts);
    if (typeof graphicOpts.shadow === 'boolean') {
        graphicOpts.shadow = {
            enable: graphicOpts.shadow
        };
    }
    graphicOpts = merge(graphicOpts, defaultGraphicConfig);

    this._renderMain = new RenderMain(renderer, scene, graphicOpts.shadow);

    this._renderMain.setShadow(graphicOpts.shadow);
    this._renderMain.setPostEffect(graphicOpts.postEffect);

    this._needsRefresh = false;

    this._graphicOpts = graphicOpts;

    timeline.on('frame', this._loop, this);
}

ClayAdvancedRenderer.prototype.render = function (renderImmediately) {
    this._needsRefresh = true;
};

ClayAdvancedRenderer.prototype.setPostEffect = function (opts) {
    merge(this._graphicOpts.postEffect, opts, true);
    this._renderMain.setPostEffect(this._graphicOpts.postEffect);
};

ClayAdvancedRenderer.prototype.setShadow = function (opts) {
    merge(this._graphicOpts.shadow, opts, true);
    this._renderMain.setShadow(this._graphicOpts.shadow);
};

ClayAdvancedRenderer.prototype._loop = function (frameTime) {
    if (this._disposed) {
        return;
    }
    if (!this._needsRefresh) {
        return;
    }

    this._needsRefresh = false;

    this._renderMain.prepareRender();
    this._renderMain.render();

    this._startAccumulating();
};

var accumulatingId = 1;
ClayAdvancedRenderer.prototype._stopAccumulating = function () {
    this._accumulatingId = 0;
    clearTimeout(this._accumulatingTimeout);
};

ClayAdvancedRenderer.prototype._startAccumulating = function (immediate) {
    var self = this;
    this._stopAccumulating();

    var needsAccumulate = self._renderMain.needsAccumulate();
    if (!needsAccumulate) {
        return;
    }

    function accumulate(id) {
        if (!self._accumulatingId || id !== self._accumulatingId || self._disposed) {
            return;
        }

        var isFinished = self._renderMain.isAccumulateFinished() && needsAccumulate;

        if (!isFinished) {
            self._renderMain.render(true);

            if (immediate) {
                accumulate(id);
            }
            else {
                requestAnimationFrame(function () {
                    accumulate(id);
                });
            }
        }
    }

    this._accumulatingId = accumulatingId++;

    if (immediate) {
        accumulate(self._accumulatingId);
    }
    else {
        this._accumulatingTimeout = setTimeout(function () {
            accumulate(self._accumulatingId);
        }, 50);
    }
};

ClayAdvancedRenderer.prototype.dispose = function () {
    this._disposed = true;

    this._renderMain.dispose();
};

ClayAdvancedRenderer.version = '0.1.0';

return ClayAdvancedRenderer;

})));
