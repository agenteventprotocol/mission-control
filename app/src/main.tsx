import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ingestOpsConnectHash, saveOpsConfig } from './state/config';
import './index.css';

// The serve connect link lands here BEFORE anything mounts: store the ops
// credentials and strip the secret from the address bar, so every panel
// boots already-configured and the token never lingers in the URL.
const ingested = ingestOpsConnectHash(location.hash);
if (ingested) {
  saveOpsConfig(ingested);
  history.replaceState(null, '', '#/connections');
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
