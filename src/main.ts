import './ui/style.css';
import './ui/hud.css';
import './ui/menu.css';
import { startViewer } from './viewer';
import { App } from './App';

const params = new URLSearchParams(location.search);
if (params.has('viewer')) {
  startViewer(params);
} else {
  const app = new App(params);
  (window as unknown as { __app: App }).__app = app;
  app.start();
}
