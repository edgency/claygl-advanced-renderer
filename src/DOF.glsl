@export car.dof.coc

uniform sampler2D depth;

uniform float zNear = 0.1;
uniform float zFar = 2000;

uniform float focalDistance = 10;
// 50mm
uniform float focalLength = 50;
// f/5.6
uniform float aperture = 5.6;

uniform float maxCoc;

// Height of the 35mm full-frame format (36mm x 24mm)
// TODO: Should be set by a physical camera
uniform float _filmHeight = 0.024;

varying vec2 v_Texcoord;

@import clay.util.encode_float

void main()
{
    float z = texture2D(depth, v_Texcoord).r * 2.0 - 1.0;

    float dist = 2.0 * zNear * zFar / (zFar + zNear - z * (zFar - zNear));

    // From https://github.com/Unity-Technologies/PostProcessing
    float f = focalLength / 1000.0;
    float s1 = max(f, focalDistance);
    float coeff = f * f / (aperture * (s1 - f) * _filmHeight * 2.0);

    float coc = (dist - focalDistance) * coeff / max(dist, 1e-5);
    coc /= maxCoc;

    gl_FragColor = vec4(clamp(coc * 0.5 + 0.5, 0.0, 1.0), 0.0, 0.0, 1.0);
}
@end

@export car.dof.composite

#define DEBUG 0

uniform sampler2D sharpTex;
uniform sampler2D nearTex;
uniform sampler2D farTex;
uniform sampler2D cocTex;
uniform float maxCoc;
uniform float minCoc;

varying vec2 v_Texcoord;

@import clay.util.rgbm

void main()
{
    float coc = texture2D(cocTex, v_Texcoord).r * 2.0 - 1.0;
    vec4 nearTexel = decodeHDR(texture2D(nearTex, v_Texcoord));
    vec4 farTexel = decodeHDR(texture2D(farTex, v_Texcoord));
    vec4 sharpTexel = decodeHDR(texture2D(sharpTex, v_Texcoord));

    float nfa = nearTexel.a;

    // Convert CoC to far field alpha value.
    float ffa = smoothstep(0.0, 0.2, coc);

    gl_FragColor.rgb = mix(mix(sharpTexel.rgb, farTexel.rgb, ffa), nearTexel.rgb, nfa);

    gl_FragColor.a = max(max(sharpTexel.a, nearTexel.a), farTexel.a);

    // gl_FragColor = sharpTexel;
}

@end

@export car.dof.separate

uniform sampler2D mainTex;
uniform sampler2D cocTex;

varying vec2 v_Texcoord;

@import clay.util.rgbm

void main()
{
    vec4 color = decodeHDR(texture2D(mainTex, v_Texcoord));
    float coc = texture2D(cocTex, v_Texcoord).r * 2.0 - 1.0;
#ifdef FARFIELD
    color *= step(0.0, coc);
#else
    color *= step(0.0, -coc);
#endif

    gl_FragColor = encodeHDR(color);
}
@end


@export car.dof.maxCoc

uniform sampler2D cocTex;
uniform vec2 textureSize;

varying vec2 v_Texcoord;

float tap(vec2 off) {
    return texture2D(cocTex, v_Texcoord + off).r * 2.0 - 1.0;
}

void main()
{
    vec2 texelSize = 1.0 / textureSize;
    vec4 d = vec4(-1.0, -1.0, +1.0, +1.0) * texelSize.xyxy;

    float coc = tap(vec2(0.0));
    float lt = tap(d.xy);
    float rt = tap(d.zy);
    float lb = tap(d.xw);
    float rb = tap(d.zw);

    coc = abs(lt) > abs(coc) ? lt : coc;
    coc = abs(rt) > abs(coc) ? rt : coc;
    coc = abs(lb) > abs(coc) ? lb : coc;
    coc = abs(rb) > abs(coc) ? rb : coc;

    gl_FragColor = vec4(coc * 0.5 + 0.5, 0.0,0.0,1.0);
}
@end



@export car.dof.blur
// https://www.shadertoy.com/view/Xd2BWc
// https://bartwronski.com/2017/08/06/separable-bokeh/
// https://www.ea.com/frostbite/news/circular-separable-convolution-depth-of-field

#define KERNEL_SIZE 17

// const vec4 Kernel0BracketsRealXY_ImZW = vec4(-0.038708,0.943062,-0.025574,0.660892);
const vec2 kernel1Weight = vec2(0.411259,-0.548794);

// const vec4 Kernel1BracketsRealXY_ImZW = vec4(0.000115,0.559524,0.000000,0.178226);
const vec2 kernel2Weight = vec2(0.513282,4.561110);

uniform vec4 kernel1[KERNEL_SIZE];
uniform vec4 kernel2[KERNEL_SIZE];

#ifdef FINAL_PASS
uniform sampler2D rTex;
uniform sampler2D gTex;
uniform sampler2D bTex;
uniform sampler2D aTex;
#else
uniform sampler2D mainTex;
#endif
uniform sampler2D cocTex;
uniform sampler2D maxCocTex;

uniform float maxCoc;
uniform vec2 textureSize;

varying vec2 v_Texcoord;

vec2 multComplex(vec2 p, vec2 q)
{
    return vec2(p.x*q.x-p.y*q.y, p.x*q.y+p.y*q.x);
}

@import clay.util.rgbm
@import clay.util.float

void main()
{
    float halfKernelSize = float(KERNEL_SIZE / 2);

    vec2 texelSize = 1.0 / textureSize;

    float weight = 0.0;

#ifdef FARFIELD
    float coc0 = texture2D(cocTex, v_Texcoord).r * 2.0 - 1.0;
    if (coc0 <= 0.0) {
        discard;
    }
#else
    float maxCoc0 = texture2D(maxCocTex, v_Texcoord).r * 2.0 - 1.0;
    float coc0 = texture2D(cocTex, v_Texcoord).r * 2.0 - 1.0;
    if (coc0 >= 0.0) {
        // Try to gathering the texel from nearfield in pixel of farfield.
        // To achieve bleeding from nearfield.
        coc0 = maxCoc0;
    }
#endif
    coc0 *= maxCoc;

// TODO Nearfield use one component.

#ifdef FINAL_PASS
    vec4 valR = vec4(0.0);
    vec4 valG = vec4(0.0);
    vec4 valB = vec4(0.0);
    vec4 valA = vec4(0.0);

    vec2 offset = vec2(0.0, coc0 / halfKernelSize);
#else
    vec4 val = vec4(0.0);

    vec2 offset = vec2(texelSize.x / texelSize.y * coc0 / halfKernelSize, 0.0);
#endif

    float margin = texelSize.y;

    for (int i = 0; i < KERNEL_SIZE; i++) {
        vec2 duv = (float(i) - halfKernelSize) * offset;
        vec2 uv = clamp(v_Texcoord + duv, vec2(0.0), vec2(1.0));
        float coc = texture2D(cocTex, uv).r * 2.0 - 1.0;
        coc *= maxCoc;

        float w = 1.0;
#ifdef FARFIELD
        // Reject pixels in focus
        // PENDING A tiny threshold?
        w = step(0.0, coc);
#endif
        weight += w;

        vec4 c0c1 = vec4(kernel1[i].xy, kernel2[i].xy);

#ifdef FINAL_PASS
        vec4 rTexel = texture2D(rTex, uv) * w;
        vec4 gTexel = texture2D(gTex, uv) * w;
        vec4 bTexel = texture2D(bTex, uv) * w;
        vec4 aTexel = texture2D(aTex, uv) * w;

        valR.xy += multComplex(rTexel.xy,c0c1.xy);
        valR.zw += multComplex(rTexel.zw,c0c1.zw);

        valG.xy += multComplex(gTexel.xy,c0c1.xy);
        valG.zw += multComplex(gTexel.zw,c0c1.zw);

        valB.xy += multComplex(bTexel.xy,c0c1.xy);
        valB.zw += multComplex(bTexel.zw,c0c1.zw);

        valA.xy += multComplex(aTexel.xy,c0c1.xy);
        valA.zw += multComplex(aTexel.zw,c0c1.zw);
#else
        vec4 color = texture2D(mainTex, uv);
        float tmp;
    #if defined(R_PASS)
        tmp = color.r;
    #elif defined(G_PASS)
        tmp = color.g;
    #elif defined(B_PASS)
        tmp = color.b;
    #elif defined(A_PASS)
        tmp = color.a;
    #endif
        val += tmp * c0c1 * w;
        // val.xy += tmp * c0c1.xy;
        // val.zw += tmp * c0c1.zw;
#endif
    }

    weight /= float(KERNEL_SIZE);

#ifdef FINAL_PASS
    valR /= weight;
    valG /= weight;
    valB /= weight;
    valA /= weight;
    float r = dot(valR.xy,kernel1Weight)+dot(valR.zw,kernel2Weight);
    float g = dot(valG.xy,kernel1Weight)+dot(valG.zw,kernel2Weight);
    float b = dot(valB.xy,kernel1Weight)+dot(valB.zw,kernel2Weight);
    float a = dot(valA.xy,kernel1Weight)+dot(valA.zw,kernel2Weight);
    gl_FragColor = vec4(r, g, b, a);
#else
    val /= weight;
    gl_FragColor = val;
#endif
}

@end