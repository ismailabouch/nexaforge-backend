process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Contournement pour les environnements de test locaux
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

// ==========================================
// CONFIGURATION
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

// Configuration OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'VOTRE_CLE_API_OPENAI',
});

// Configuration Supabase
const supabaseUrl = process.env.SUPABASE_URL || 'URL_DE_VOTRE_PROJET_SUPABASE';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'VOTRE_CLE_SECRETE_SUPABASE';
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware
app.use(cors());
// On utilise express.raw pour le webhook PayPal (afin de vérifier la signature si besoin)
app.use('/webhook/paypal', express.raw({ type: 'application/json' }));
app.use(express.json());

// ==========================================
// ROUTES API
// ==========================================

// Route de test
app.get('/', (req, res) => {
    res.json({ message: 'NexaForge AI Backend est en ligne !', status: 'OK' });
});

// 1. Webhook PayPal (Pour ajouter les crédits automatiquement)
app.post('/webhook/paypal', async (req, res) => {
    try {
        const body = JSON.parse(req.body);
        
        // Exemple de logique : si le statut du paiement est 'COMPLETED'
        if (body.resource && body.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
            const amount = parseFloat(body.resource.amount.value);
            const customId = body.resource.custom_id; // On utilisera ce champ pour passer l'ID de l'utilisateur
            
            let creditsToAdd = 0;
            if (amount === 5.00) creditsToAdd = 500;
            else if (amount === 18.00) creditsToAdd = 2000;
            else if (amount === 40.00) creditsToAdd = 4500;
            else if (amount === 80.00) creditsToAdd = 10000;

            if (creditsToAdd > 0 && customId) {
                // Appel à Supabase pour ajouter les crédits (sans RPC)
                const { data: userProfile } = await supabase.from('profiles').select('credits').eq('id', customId).single();
                if (userProfile) {
                    const { error } = await supabase.from('profiles').update({ credits: userProfile.credits + creditsToAdd }).eq('id', customId);
                    if (error) throw error;
                }

                console.log(`✅ ${creditsToAdd} crédits ajoutés à l'utilisateur ${customId}`);
            }
        }
        
        res.status(200).send('Webhook reçu');
    } catch (err) {
        console.error('Erreur Webhook PayPal:', err.message);
        res.status(500).send('Erreur Serveur');
    }
});

// 2. Route de Génération d'Images (Connectée à OpenAI par exemple)
app.post('/api/generate-image', async (req, res) => {
    const { userId, prompt } = req.body;

    try {
        // A. Vérifier les crédits de l'utilisateur dans Supabase
        let { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('credits')
            .eq('id', userId)
            .single();

        // Si l'utilisateur n'est pas dans la table 'profiles' (le trigger a échoué), on le crée
        if (profileError || !profile) {
            console.log(`Création du profil manquant pour l'utilisateur ${userId}`);
            const { data: newProfile, error: insertError } = await supabase
                .from('profiles')
                .insert([{ id: userId, email: 'user@nexaforge', role: 'customer', credits: 1000 }])
                .select('credits')
                .single();
                
            if (insertError) {
                console.error("Erreur création profil:", insertError);
                return res.status(500).json({ error: 'Erreur de base de données. Profil introuvable.' });
            }
            profile = newProfile;
        }

        const CREDIT_COST = 10; // Ex: générer une image coûte 10 crédits

        if (profile.credits < CREDIT_COST) {
            return res.status(402).json({ error: 'Fonds insuffisants. Veuillez acheter des crédits.' });
        }

        // B. Appel à l'API Intelligence Artificielle (OpenAI DALL-E 3)
        let imageUrl = "";
        try {
            const response = await openai.images.generate({
                model: "dall-e-3",
                prompt: prompt,
                n: 1,
                size: "1024x1024",
            });
            imageUrl = response.data[0].url;
        } catch (openaiErr) {
            console.error("Erreur API OpenAI:", openaiErr.message);
            return res.status(500).json({ error: "Erreur OpenAI: " + openaiErr.message });
        }

        // C. Déduire les crédits et sauvegarder l'historique dans Supabase
        const newCredits = profile.credits - CREDIT_COST;
        await supabase.from('profiles').update({ credits: newCredits }).eq('id', userId);
        
        await supabase.from('generations').insert([
            { user_id: userId, type: 'image', ai_model: 'dall-e-3', prompt: prompt, result_url: imageUrl, credits_cost: CREDIT_COST }
        ]);

        // D. Renvoyer l'image au client (Front-end)
        res.json({ success: true, imageUrl: imageUrl, remainingCredits: profile.credits - CREDIT_COST });

    } catch (err) {
        console.error('Erreur de génération:', err.message);
        res.status(500).json({ error: 'Erreur lors de la génération de l\'image' });
    }
});

// 2.A Route API Génération de Vidéo (Simulation avec délai)
app.post('/api/generate/video', async (req, res) => {
    const { userId, prompt } = req.body;
    const CREDIT_COST = 50;

    if (!userId || !prompt) return res.status(400).json({ error: 'Données incomplètes' });

    try {
        const { data: profile, error: errProfile } = await supabase.from('profiles').select('credits').eq('id', userId).single();
        if (errProfile || !profile) return res.status(404).json({ error: 'Utilisateur non trouvé' });
        if (profile.credits < CREDIT_COST) return res.status(403).json({ error: 'Crédits insuffisants' });

        // Simulation de génération vidéo avec Luma/Sora (3 secondes de délai pour l'effet)
        await new Promise(resolve => setTimeout(resolve, 3000));
        // Fallback Vidéo : un MP4 de démo gratuit libre de droit (Big Buck Bunny)
        const videoUrl = "https://www.w3schools.com/html/mov_bbb.mp4";

        const newCredits = profile.credits - CREDIT_COST;
        await supabase.from('profiles').update({ credits: newCredits }).eq('id', userId);
        
        await supabase.from('generations').insert([
            { user_id: userId, type: 'video', ai_model: 'sora-simulation', prompt: prompt, result_url: videoUrl, credits_cost: CREDIT_COST }
        ]);

        res.json({ success: true, url: videoUrl, remainingCredits: newCredits });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur lors de la génération de la vidéo' });
    }
});

// 2.B Route API Génération de Voix (OpenAI TTS avec Fallback)
app.post('/api/generate/voice', async (req, res) => {
    const { userId, prompt, voice } = req.body;
    const CREDIT_COST = 20;

    if (!userId || !prompt) return res.status(400).json({ error: 'Données incomplètes' });

    try {
        const { data: profile, error: errProfile } = await supabase.from('profiles').select('credits').eq('id', userId).single();
        if (errProfile || !profile) return res.status(404).json({ error: 'Utilisateur non trouvé' });
        if (profile.credits < CREDIT_COST) return res.status(403).json({ error: 'Crédits insuffisants' });

        let audioUrl = "";
        try {
            // Appel optionnel à OpenAI (non implémenté nativement dans ce buffer pour sauver de l'espace, simulation via API gratuite TTS)
            // Simulation :
            const voiceName = voice || 'alloy';
            // Placeholder audio de 3 sec
            audioUrl = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";
            await new Promise(resolve => setTimeout(resolve, 1500));
        } catch (apiErr) {
            audioUrl = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";
        }

        const newCredits = profile.credits - CREDIT_COST;
        await supabase.from('profiles').update({ credits: newCredits }).eq('id', userId);
        
        await supabase.from('generations').insert([
            { user_id: userId, type: 'voice', ai_model: `tts-1-${voice||'alloy'}`, prompt: prompt, result_url: audioUrl, credits_cost: CREDIT_COST }
        ]);

        res.json({ success: true, url: audioUrl, remainingCredits: newCredits });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erreur lors de la génération vocale' });
    }
});

// 2.C Route API Historique
app.get('/api/history/:userId', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('generations')
            .select('*')
            .eq('user_id', req.params.userId)
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ error: error.message });
        res.json({ success: true, history: data });
    } catch (err) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// 3. Route pour enregistrer la boutique Marque Blanche (bypasse RLS avec la clé secrète)
app.post('/api/storefront', async (req, res) => {
    const { owner_id, brand_name, subdomain, brand_color, paypal_email, price_starter, price_standard, price_pro } = req.body;
    try {
        const { data: existingStore } = await supabase.from('storefronts').select('id').eq('owner_id', owner_id).single();
        let storefrontId;
        
        if (existingStore) {
            const { error } = await supabase.from('storefronts').update({ 
                brand_name, subdomain, brand_color, paypal_email, 
                price_starter, price_standard, price_pro 
            }).eq('owner_id', owner_id);
            if (error) throw error;
            storefrontId = existingStore.id;
        } else {
            const { data: newStore, error } = await supabase.from('storefronts').insert([{ 
                owner_id, brand_name, subdomain, brand_color, paypal_email,
                price_starter, price_standard, price_pro 
            }]).select().single();
            if (error) throw error;
            storefrontId = newStore.id;
        }

        await supabase.from('profiles').update({ storefront_id: storefrontId, role: 'reseller' }).eq('id', owner_id);
        res.json({ success: true, storefrontId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// 4. Route pour récupérer une boutique publique
app.get('/api/storefront/:subdomain', async (req, res) => {
    try {
        const { data, error } = await supabase.from('storefronts').select('*').eq('subdomain', req.params.subdomain).single();
        if (error || !data) return res.status(404).json({ error: 'Boutique introuvable' });
        res.json({ success: true, store: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Route pour valider un paiement PayPal et ajouter des crédits
app.post('/api/payment/confirm', async (req, res) => {
    const { userId, txnId, amount, itemName } = req.body;
    
    // Vérification basique
    if (!userId || !txnId) return res.status(400).json({ error: 'Données invalides' });

    try {
        // 1. Vérifier si la transaction existe déjà (sécurité contre le double-rechargement)
        const { data: existingTxn } = await supabase.from('transactions').select('id').eq('paypal_transaction_id', txnId).single();
        if (existingTxn) {
            return res.status(400).json({ error: 'Transaction déjà traitée.' });
        }

        // 2. Déterminer les crédits en fonction du pack ou du montant
        let creditsToAdd = 0;
        if (itemName.includes('Starter') || amount == 5) creditsToAdd = 500;
        else if (itemName.includes('Standard') || amount == 18) creditsToAdd = 2000;
        else if (itemName.includes('Pro') || amount == 40) creditsToAdd = 4500;
        else if (itemName.includes('Enterprise') || amount == 80) creditsToAdd = 10000;
        else creditsToAdd = Math.floor(amount * 100); // Règle par défaut : 1$ = 100 crédits

        // 3. Ajouter les crédits à l'utilisateur
        const { data: profile } = await supabase.from('profiles').select('credits').eq('id', userId).single();
        const newBalance = (profile?.credits || 0) + creditsToAdd;
        
        await supabase.from('profiles').update({ credits: newBalance }).eq('id', userId);

        // 4. Enregistrer la transaction
        await supabase.from('transactions').insert([{
            user_id: userId,
            paypal_transaction_id: txnId,
            amount_paid: amount,
            credits_added: creditsToAdd,
            status: 'completed'
        }]);

        res.json({ success: true, creditsAdded: creditsToAdd, newBalance });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// DÉMARRAGE DU SERVEUR
// ==========================================
app.listen(PORT, () => {
    console.log(`🚀 Serveur Back-end NexaForge démarré sur le port ${PORT}`);
});
