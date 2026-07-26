(() => {
  'use strict';

  const loading = document.getElementById('appLoading');
  const shell = document.querySelector('.app-shell');

  function showFailure(error) {
    console.error(error);
    loading.classList.add('is-error');
    loading.innerHTML = `
      <div>
        <strong>City data could not load.</strong><br>
        <span>Refresh the page, or try again from a normal web server.</span>
      </div>
    `;
  }

  async function loadData() {
    const manifestResponse = await fetch('data/manifest.json');
    if (!manifestResponse.ok) {
      throw new Error(`Data manifest failed with ${manifestResponse.status}`);
    }

    const manifest = await manifestResponse.json();
    const chunkResponses = await Promise.all(
      manifest.chunks.map(async (file) => {
        const response = await fetch(`data/${file}`);
        if (!response.ok) {
          throw new Error(`${file} failed with ${response.status}`);
        }
        return response.json();
      })
    );

    const places = chunkResponses.flat();
    if (places.length !== manifest.count) {
      throw new Error(`Expected ${manifest.count} places, received ${places.length}`);
    }

    window.PLACE_DATA = { meta: manifest.meta, places };
  }

  function startApplication() {
    const script = document.createElement('script');
    script.src = 'app.js';
    script.onload = () => {
      shell.removeAttribute('aria-busy');
      loading.classList.add('is-complete');
      window.setTimeout(() => loading.remove(), 220);
    };
    script.onerror = () => showFailure(new Error('Application script failed to load'));
    document.body.append(script);
  }

  loadData().then(startApplication).catch(showFailure);
})();
