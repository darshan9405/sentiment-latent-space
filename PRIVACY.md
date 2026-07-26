# Privacy Policy

Last updated: July 26, 2026

Sentiment Latent Space is a Chrome extension that runs entirely in your browser.

## Data we collect

**We do not collect any data.** The extension does not send your Reddit posts, comments, browsing history, or any personal information to any server.

## How it works

- When you click the "Analyze in 3D" button, the extension fetches the current Reddit post's public `.json` data directly from Reddit using your existing browser session.
- All analysis — text embeddings, dimensionality reduction, clustering, and 3D rendering — is performed locally on your device.
- On first use, the embedding model (`all-MiniLM-L6-v2`) is downloaded from Hugging Face and cached locally in your browser. After that, it is loaded from the cache.

## Third-party services

- **Reddit**: The extension reads the post's public `.json` endpoint from the same origin as the page you are already visiting.
- **Hugging Face**: The extension downloads the embedding model from `huggingface.co` on first use.

No analytics, tracking, or advertising services are used.

## Contact

If you have questions about this privacy policy, please contact the developer.
