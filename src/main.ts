import './ui/style.css';
import './ui/hud.css';
import './ui/menu.css';
import { startViewer } from './viewer';
import { App } from './App';
import { preloadChampionModels } from './champions/glbModels';
import * as THREE from 'three';

const params = new URLSearchParams(location.search);
// champion GLB models first (falls back to the procedural models if missing; ?models=0 forces them)
void preloadChampionModels(params).then(() => {
  if (params.has('viewer')) {
    startViewer(params);
  } else {
    const app = new App(params);
    (window as unknown as { __app: App; __THREE: typeof THREE }).__app = app;
    (window as unknown as { __THREE: typeof THREE }).__THREE = THREE;
    app.start();
  }
});
