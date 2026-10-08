import './ui/style.css';
import './ui/hud.css';
import './ui/menu.css';
import { startViewer } from './viewer';
import { App } from './App';
import * as THREE from 'three';

const params = new URLSearchParams(location.search);
if (params.has('viewer')) {
  startViewer(params);
} else {
  const app = new App(params);
  (window as unknown as { __app: App; __THREE: typeof THREE }).__app = app;
  (window as unknown as { __THREE: typeof THREE }).__THREE = THREE;
  app.start();
}
