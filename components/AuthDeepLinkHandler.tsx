import { router } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Linking } from 'react-native';
import { supabase } from '../lib/supabase';
import { navigateAfterAuth } from '../lib/continueAfterAuth';
import { createOrUpdateUserFromGoogle } from '../services/supabase/userService';

// Função auxiliar para fazer parsing de URLs customizadas (marcaai://)
const parseCustomURL = (url: string): { path: string; params: URLSearchParams } => {
  console.log('🔍 [parseCustomURL] URL original:', url);
  console.log('🔍 [parseCustomURL] Tipo da URL:', typeof url);
  console.log('🔍 [parseCustomURL] Tamanho da URL:', url.length);
  
  // Criar um objeto de parâmetros combinado
  const allParams = new URLSearchParams();
  let path = '';
  
  try {
    // Tentar usar URL nativo primeiro (funciona se a URL for http/https)
    const urlObj = new URL(url);
    console.log('🔍 [parseCustomURL] URL nativo funcionou');
    path = urlObj.pathname;
    
    // Adicionar parâmetros da query string
    urlObj.searchParams.forEach((value, key) => {
      allParams.append(key, value);
    });
    
    // Adicionar parâmetros do hash se existir
    if (urlObj.hash) {
      const hashParams = new URLSearchParams(urlObj.hash.substring(1));
      hashParams.forEach((value, key) => {
        allParams.append(key, value);
      });
    }
    
    return { path, params: allParams };
  } catch (error) {
    console.log('🔍 [parseCustomURL] URL nativo falhou, usando parsing manual');
    
    // Se falhar, fazer parsing manual para URLs customizadas (marcaai://)
    // Suporta tanto ? (query string) quanto # (hash)
    
    // Extrair hash primeiro (tem prioridade)
    let hashString = '';
    let queryString = '';
    let baseUrl = url;
    
    // Verificar se tem hash (#)
    const hashIndex = url.indexOf('#');
    if (hashIndex !== -1) {
      hashString = url.substring(hashIndex + 1);
      baseUrl = url.substring(0, hashIndex);
      console.log('🔍 [parseCustomURL] Encontrado hash:', hashString);
    }
    
    // Verificar se tem query string (?)
    const queryIndex = baseUrl.indexOf('?');
    if (queryIndex !== -1) {
      queryString = baseUrl.substring(queryIndex + 1);
      baseUrl = baseUrl.substring(0, queryIndex);
      console.log('🔍 [parseCustomURL] Encontrado query string:', queryString);
    }
    
    // Extrair path do baseUrl (marcaai://reset-password)
    const pathMatch = baseUrl.match(/^([^:]+):\/\/(.+)$/);
    if (pathMatch) {
      path = pathMatch[2];
    } else {
      // Se não tiver scheme, pode ser apenas o path
      path = baseUrl;
    }
    
    console.log('🔍 [parseCustomURL] Path extraído:', path);
    console.log('🔍 [parseCustomURL] Query string:', queryString);
    console.log('🔍 [parseCustomURL] Hash string:', hashString);
    
    // Adicionar parâmetros da query string
    if (queryString) {
      const queryParams = new URLSearchParams(queryString);
      queryParams.forEach((value, key) => {
        allParams.append(key, value);
      });
    }
    
    // Adicionar parâmetros do hash (sobrescreve query string se houver conflito)
    if (hashString) {
      const hashParams = new URLSearchParams(hashString);
      hashParams.forEach((value, key) => {
        allParams.set(key, value); // set ao invés de append para sobrescrever
      });
    }
    
    console.log('🔍 [parseCustomURL] Todos os parâmetros extraídos:', Array.from(allParams.entries()));
    
    return { path, params: allParams };
  }
};

export default function AuthDeepLinkHandler() {
  useEffect(() => {
    // Listener para deep links quando o app está aberto
    const handleDeepLink = (url: string) => {
      console.log('🔵 [Deep Link] URL recebida:', url);
      console.log('🔵 [Deep Link] URL completa (raw):', JSON.stringify(url));
      
      // Verificar se é uma URL HTTP/HTTPS intermediária do Supabase
      // O Supabase pode redirecionar primeiro para uma URL HTTP antes do deep link
      if ((url.startsWith('http://') || url.startsWith('https://')) && 
          (url.includes('auth/callback') || url.includes('type=recovery') || url.includes('type=signup'))) {
        console.log('🔵 [Deep Link] Detectada URL HTTP intermediária do Supabase');
        // Extrair parâmetros e construir deep link
        const { path, params } = parseCustomURL(url);
        const paramString = Array.from(params.entries())
          .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
          .join('&');
        const deepLink = `marcaai://auth/callback?${paramString}`;
        console.log('🔵 [Deep Link] Redirecionando para deep link:', deepLink);
        // Usar Linking para abrir o deep link
        Linking.openURL(deepLink).catch(err => {
          console.error('❌ [Deep Link] Erro ao abrir deep link:', err);
        });
        return;
      }
      
      // Verificar se é callback do Google OAuth (redirect do Supabase)
      if (url.includes('access_token') && url.includes('refresh_token') && !url.includes('marcaai://auth/callback')) {
        // Extrair parâmetros da URL usando função auxiliar
        const { params } = parseCustomURL(url);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        const type = params.get('type');
        const expiresIn = params.get('expires_in');

        if (accessToken && refreshToken) {
          // Definir a sessão com os tokens do OAuth
          supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          }).then(async ({ data, error }) => {
            if (error) {
              console.error('❌ Erro ao definir sessão OAuth:', error);
              return;
            }

            // Verificar se a sessão foi realmente salva
            const { data: { session } } = await supabase.auth.getSession();

            if (session && session.user) {
              // Criar ou atualizar usuário com dados do Google OAuth
              const userMetadata = session.user.user_metadata;
              
              let isNewUser = false;
              if (userMetadata && session.user.email) {
                const result = await createOrUpdateUserFromGoogle(
                  session.user.id,
                  {
                    name: userMetadata.full_name || userMetadata.name || session.user.email,
                    email: session.user.email,
                    photo: userMetadata.avatar_url || userMetadata.picture || undefined,
                  }
                );
                isNewUser = Boolean(result.isNewUser);
              }
              await navigateAfterAuth(undefined, session.user.id, isNewUser);
            } else {
              console.error('❌ Sessão OAuth não foi salva corretamente');
            }
          });
        }
      }
      // Callback original para email confirmation e reset de senha
      else if (url.includes('marcaai://auth/callback')) {
        // Extrair parâmetros da URL usando função auxiliar
        const { params } = parseCustomURL(url);
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        const type = params.get('type');

        console.log('🔵 [Auth Callback] Tipo:', type);
        console.log('🔵 [Auth Callback] Tokens:', { 
          hasAccessToken: !!accessToken, 
          hasRefreshToken: !!refreshToken 
        });

        if (accessToken && refreshToken) {
          // Verificar se é reset de senha (type=recovery)
          if (type === 'recovery') {
            console.log('🔵 [Reset Password] Processando via auth/callback');
            supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            }).then(({ data, error }) => {
              if (error) {
                console.error('❌ [Reset Password] Erro ao definir sessão:', error);
                Alert.alert('Erro', 'Link de recuperação inválido ou expirado');
                router.replace('/login');
                return;
              }
              console.log('✅ [Reset Password] Sessão definida com sucesso, navegando para reset-password');
              router.replace('/reset-password');
            });
            return;
          }

          // Se for signup (confirmação de email)
          if (type === 'signup') {
            // Trocar o código pela sessão
            supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            }).then(async ({ data, error }) => {
              if (error) {
                console.error('Erro ao definir sessão:', error);
                Alert.alert('Erro', 'Erro ao confirmar email. Tente novamente.');
                router.replace('/login');
                return;
              }

              console.log('✅ [Email Confirmation] Email confirmado com sucesso, navegando para login');
              // Sempre navegar para login após confirmar email
              router.replace('/login');
            });
          }
        }
      }
    };

    // Listener para quando o app é aberto via deep link
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleDeepLink(url);
    });

    // Verificar se o app foi aberto via deep link
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleDeepLink(url);
      }
    });

    return () => {
      subscription?.remove();
    };
  }, []);

  return null; // Este componente não renderiza nada
}
