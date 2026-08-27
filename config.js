// config.js
/*const SUPABASE_URL = 'https://xijoilglijvwozklatxa.supabase.co'// Weka Project URL yako
const SUPABASE_KEY = 'sb_publishable_qAINvRS-w-MlxngWsSHa9Q_QBbF1mkp' // Weka anon public key yako
*/


const SUPABASE_URL = "https://xijoilglijvwozklatxa.supabase.co";
const SUPABASE_KEY = "sb_publishable_qAINvRS-w-MlxngWsSHa9Q_QBbF1mkp";
const SUPABASE_ANON_KEY = "sb_publishable_qAINvRS-w-MlxngWsSHa9Q_QBbF1mkp";

// Kuondoa error ya Missing
if (typeof window !== 'undefined') {
  window.SUPABASE_URL = SUPABASE_URL;
  window.SUPABASE_KEY = SUPABASE_KEY;
}
