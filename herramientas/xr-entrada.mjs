// Entrada del paquete de librerías para vr.html. Se empaqueta en UN solo archivo
// (docs/js/vendor/xr.js) para que la página de AR cargue rápido: antes se bajaban
// decenas de módulos sueltos desde esm.sh, uno tras otro.
// Solo se exportan las piezas de three.js que usa vr.js, así el empaquetador descarta el resto.
// Regenerar:  cd herramientas  ·  npm install  ·  npm run xr
import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, Group, Mesh,
  RingGeometry, PlaneGeometry, BufferGeometry, MeshBasicMaterial, LineBasicMaterial, Line,
  Sprite, SpriteMaterial, CanvasTexture, SRGBColorSpace, Raycaster, Matrix4, Vector2, Vector3,
  Clock, Color, MathUtils,
} from 'three';

export const THREE = {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, Group, Mesh,
  RingGeometry, PlaneGeometry, BufferGeometry, MeshBasicMaterial, LineBasicMaterial, Line,
  Sprite, SpriteMaterial, CanvasTexture, SRGBColorSpace, Raycaster, Matrix4, Vector2, Vector3,
  Clock, Color, MathUtils,
};
export { default as ThreeGlobe } from 'three-globe';
export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
