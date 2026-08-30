import { createClient } from "@supabase/supabase-js";

// Connexion au projet Supabase "au-menu"
// La clé "publishable" est publique par conception : la sécurité
// est assurée côté base par les policies (chacun ne voit que ses semaines).
const SUPABASE_URL = "https://pbnfrmmujstrlrzxskih.supabase.co";
const SUPABASE_KEY = "sb_publishable_CQBEeeGgutB4t24YBzoBXg_G71LDKCK";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
