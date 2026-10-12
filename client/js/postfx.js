// Post-processing stack: ambient occlusion, bloom, anti-aliasing and a filmic grade.
// One composer serves every scene (match, menu, obby) — the render pass is re-pointed per frame.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

// Quality tiers. Each one only turns passes on/off — the chain itself is built once.
export const QUALITY = {
  low: { ao: false, bloom: false, smaa: false, grade: true, aoScale: 0.5, bloomStrength: 0 },
  medium: { ao: false, bloom: true, smaa: true, grade: true, aoScale: 0.5, bloomStrength: 0.22 },
  high: { ao: true, bloom: true, smaa: true, grade: true, aoScale: 0.75, bloomStrength: 0.3 },
  ultra: { ao: true, bloom: true, smaa: true, grade: true, aoScale: 1, bloomStrength: 0.38 },
};
export const QUALITY_NAMES = ['low', 'medium', 'high', 'ultra'];

// Final LDR grade: unsharp mask, edge chromatic aberration, filmic contrast/saturation,
// vignette and animated grain. Cheap enough to run as one fullscreen pass.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    texelSize: { value: new THREE.Vector2() },
    time: { value: 0 },
    sharpen: { value: 0.35 },
    aberration: { value: 0.0016 },
    vignette: { value: 0.34 },
    grain: { value: 0.035 },
    saturation: { value: 1.35 },
    contrast: { value: 1.12 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 texelSize;
    uniform float time, sharpen, aberration, vignette, grain, saturation, contrast;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

    void main() {
      vec2 toCenter = vUv - 0.5;
      float r2 = dot(toCenter, toCenter);

      // Chromatic aberration — scales with distance from the centre so the crosshair stays clean.
      vec2 ca = toCenter * aberration * r2 * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - ca).b;

      // Unsharp mask for crisp edges on distant geometry.
      vec3 blur = (
        texture2D(tDiffuse, vUv + vec2(texelSize.x, 0.0)).rgb +
        texture2D(tDiffuse, vUv - vec2(texelSize.x, 0.0)).rgb +
        texture2D(tDiffuse, vUv + vec2(0.0, texelSize.y)).rgb +
        texture2D(tDiffuse, vUv - vec2(0.0, texelSize.y)).rgb) * 0.25;
      col += (col - blur) * sharpen;

      // Filmic contrast around mid grey, then saturation.
      col = (col - 0.5) * contrast + 0.5;
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, saturation);

      col *= 1.0 - vignette * smoothstep(0.15, 0.85, r2);
      col += (hash(vUv * 1024.0 + fract(time) * 97.0) - 0.5) * grain;

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera, quality = 'high') {
    this.renderer = renderer;
    this.enabled = true;
    this.quality = QUALITY[quality] ? quality : 'high';

    const size = renderer.getSize(new THREE.Vector2());
    const composer = (this.composer = new EffectComposer(renderer));
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);

    this.renderPass = new RenderPass(scene, camera);
    composer.addPass(this.renderPass);

    // Ambient occlusion — the single biggest win: contact shadows where geometry meets.
    this.ao = new GTAOPass(scene, camera, size.x, size.y);
    this.ao.output = GTAOPass.OUTPUT.Default;
    this.ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.4, thickness: 0.4, scale: 1.1, samples: 16, screenSpaceRadius: false });
    composer.addPass(this.ao);

    // Viewmodel draws after AO so the gun never self-occludes, but before bloom so muzzle flash glows.
    this.vmPass = new RenderPass(scene, camera);
    this.vmPass.clear = false;
    this.vmPass.clearDepth = true;
    this.vmPass.enabled = false;
    composer.addPass(this.vmPass);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.6, 1.5);
    composer.addPass(this.bloom);

    composer.addPass(new OutputPass());

    this.smaa = new SMAAPass();
    composer.addPass(this.smaa);

    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);

    this.setQuality(this.quality);
  }

  setQuality(name) {
    const q = QUALITY[name];
    if (!q) return;
    this.quality = name;
    this.ao.enabled = q.ao;
    this.bloom.enabled = q.bloom;
    this.bloom.strength = q.bloomStrength;
    this.smaa.enabled = q.smaa;
    this.grade.enabled = q.grade;
    this.resize();
  }

  resize() {
    const size = this.renderer.getSize(new THREE.Vector2());
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x, size.y);
    // AO runs at a fraction of the frame on lower tiers; it is a low-frequency signal so it scales well.
    const s = QUALITY[this.quality].aoScale;
    this.ao.setSize(Math.max(1, Math.round(size.x * s)), Math.max(1, Math.round(size.y * s)));
    this.grade.uniforms.texelSize.value.set(1 / Math.max(1, size.x * pr), 1 / Math.max(1, size.y * pr));
  }

  // Point the chain at a scene and draw. `vm` is the optional first-person viewmodel layer.
  render(scene, camera, vm, dt = 0) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.ao.scene = scene;
    this.ao.camera = camera;
    if (vm) {
      this.vmPass.enabled = true;
      this.vmPass.scene = vm.scene;
      this.vmPass.camera = vm.camera;
    } else {
      this.vmPass.enabled = false;
    }
    this.grade.uniforms.time.value += dt;
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose?.();
  }
}
