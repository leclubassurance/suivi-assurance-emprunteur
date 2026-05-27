import { getApiUrl } from './utils';

export async function extractDocumentsSequentially(documents: any[], context?: { manualPrets?: string }) {
  if (!documents || documents.length === 0) return { loading: false, observations: "Aucun document à analyser." };

  try {
    const res = await fetch(getApiUrl('/api/extract'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documents, context })
    });
    
    if (!res.ok) {
      let errorText = await res.text();
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error) errorText = errorJson.error;
        else if (errorJson.observations) errorText = errorJson.observations;
      } catch (e) {
        // ignore
      }
      console.error('Server error:', errorText);
      throw new Error(errorText || `Erreur serveur (${res.status})`);
    }
    
    const data = await res.json();
    return { ...data, loading: false };
  } catch (err) {
    console.error('Failed to extract documents', err);
    return { loading: false, observations: "Échec de l'extraction automatique des documents." };
  }
}
