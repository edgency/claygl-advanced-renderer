# ClayGL Advanced Renderer

ClayGL advanced renderer provide a full render pipeline which includes:

+ Bloom
+ Screen Space Ambient Occlusion
+ Screen Space Reflection
+ Depth of Field
+ Color Correction
+ ACES Tone Mapping
+ FXAA
+ Temporal Anti-Aliasing
+ Progressive Enhancement on SSAO, SSR, Shadow.

## Install from NPM

```bash
npm install claygl
npm install claygl-advanced-renderer
```

## Basic Usage

```html
<html>
<head>
  <meta charset="utf-8">
  <script src="../node_modules/claygl/dist/claygl.js"></script>
  <script src="../dist/claygl-advanced-renderer.js"></script>
</head>
<body>
  <div id="main"></div>

  <script type="text/javascript">
    clay.application.create('#main', {
      width: window.innerWidth,
      height: window.innerHeight,

      autoRender: false,

      init: function (app) {
        this._advancedRenderer = new ClayAdvancedRenderer(app.renderer, app.scene, app.timeline, {
          // See full graphic configuration at
          // https://github.com/pissang/claygl-advanced-renderer/blob/master/src/defaultGraphicConfig.js
          shadow: true
        });

        // Create a perspective camera.
        // First parameter is the camera position. Which is in front of the cube.
        // Second parameter is the camera lookAt target. Which is the origin of the world, and where the cube puts.
        this._camera = app.createCamera([0, 2, 5], [0, 0, 0]);

        // Create a sample cube
        this._cube = app.createCube({
          color: 'red'
        });
        // Create a ground
        this._ground = app.createPlane();
        this._ground.rotation.rotateX(-Math.PI / 2);
        this._ground.scale.set(2, 2, 1);

        // Create a directional light. The direction is from top right to left bottom, away from camera.
        this._mainLight = app.createDirectionalLight([-1, -2, -1]);

        this._advancedRenderer.render();
      }
    })
  </script>
</body>
</html>
```