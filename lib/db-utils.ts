/**
 * Database utilities - pentru debugging și management IndexedDB
 * 
 * Folosire în Browser Console:
 * 1. Deschide DevTools (F12)
 * 2. Mergi la Console tab
 * 3. Copiază și rulează comenzile de mai jos
 */

import { bigDataStore } from './bigdata-store';

// Export pentru console
if (typeof window !== 'undefined') {
  (window as any).dbUtils = {
    // Vedere toate rezultatele
    async viewAll() {
      const results = await bigDataStore.getAllResults();
      console.table(results);
      return results;
    },

    // Numără rezultatele
    async count() {
      const count = await bigDataStore.getResultCount();
      console.log(` Total results: ${count}`);
      return count;
    },

    // Rezultate după status
    async byStatus(status: 'pending' | 'processing' | 'completed' | 'error') {
      const results = await bigDataStore.getResultsByStatus(status);
      console.table(results);
      return results;
    },

    // Vezi statistici
    async stats() {
      const stats = await bigDataStore.getStats();
      console.log(' Stats:', stats);
      return stats;
    },

    // Șterge toate rezultatele
    async clear() {
      await bigDataStore.clearResults();
      console.log(' Database cleared!');
    },

    // Șterge întreaga bază de date
    async deleteDB() {
      if (confirm('Are you sure you want to delete the entire database?')) {
        await indexedDB.deleteDatabase('big-data-processor');
        console.log(' Database deleted! Reload the page.');
        window.location.reload();
      }
    },

    // Info despre storage
    async storageInfo() {
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        const usedMB = ((estimate.usage || 0) / 1024 / 1024).toFixed(2);
        const quotaMB = ((estimate.quota || 0) / 1024 / 1024).toFixed(2);
        const percentUsed = ((estimate.usage || 0) / (estimate.quota || 1) * 100).toFixed(2);
        
        console.log(` Storage Info:
  Used: ${usedMB} MB
  Quota: ${quotaMB} MB
  Used: ${percentUsed}%`);
        
        return estimate;
      }
    },

    // Help
    help() {
      console.log(`
 Database Utils - Available Commands:

await dbUtils.viewAll()       - Vezi toate rezultatele în console
await dbUtils.count()          - Numără rezultatele
await dbUtils.byStatus('completed') - Filtrează după status
await dbUtils.stats()          - Vezi statistici
await dbUtils.clear()          - Șterge toate rezultatele
await dbUtils.deleteDB()       - Șterge întreaga DB (cu confirmare)
await dbUtils.storageInfo()    - Info despre storage browser

 IndexedDB Location:
Chrome: C:\\Users\\Mihai\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\IndexedDB
Edge:   C:\\Users\\Mihai\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\IndexedDB

 DevTools Access:
F12 → Application → IndexedDB → big-data-processor
      `);
    }
  };

  // Auto-afișează help
  console.log(' Database utils loaded! Type dbUtils.help() for commands');
}
