import { Ionicons } from '@expo/vector-icons';
import messaging from '@react-native-firebase/messaging';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    Alert,
    BackHandler,
    KeyboardAvoidingView,
    LogBox,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppleSignInButton, { AppleSignInResult } from '../../../components/AppleSignInButton';
import GoogleGLogo from '../../../components/GoogleGLogo';
import MeuShowWordmark from '../../../components/MeuShowWordmark';
import { useActiveArtistContext } from '../../../contexts/ActiveArtistContext';
import { useTheme } from '../../../contexts/ThemeContext';
import { supabase } from '../../../lib/supabase';
import { checkArtistsAndRedirect, getCurrentUser, loginUser, logoutUser, resendConfirmationEmail, sendPasswordResetEmail } from '../../../services/supabase/authService';
import {
    checkUserExists,
    createOrUpdateUserFromApple,
    createOrUpdateUserFromGoogle,
    saveFCMToken,
} from '../../../services/supabase/userService';
import { sanitizeLoginParentStackIfNeeded } from '../../../lib/resetToLoginStack';
import { maybeShowConnectionError } from '../../../utils/maybeShowConnectionError';

// Configurar Google Sign-In: webClientId obrigatório (Android + Supabase). iosClientId só no iOS.
GoogleSignin.configure({
  webClientId: '169304206053-i5bm2l2sofd011muqr66ddm2dosn5bn9.apps.googleusercontent.com',
  ...(Platform.OS === 'ios' && {
    iosClientId: '169304206053-642isf3lub3ds2thkiupcje9r7lo7dh7.apps.googleusercontent.com',
  }),
});

// Ignorar erros de rede no console
LogBox.ignoreLogs([
  'Network request failed',
  'TypeError: Network request failed',
]);

export default function LoginScreen() {
  const navigation = useNavigation();
  const { colors, isDarkMode } = useTheme();
  const { setActiveArtist } = useActiveArtistContext();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showCompleteProfileModal, setShowCompleteProfileModal] = useState(false);
  const [showEmailConfirmationModal, setShowEmailConfirmationModal] = useState(false);
  const [emailConfirmationError, setEmailConfirmationError] = useState<string>('');
  const [resendingEmail, setResendingEmail] = useState(false);
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [sendingResetEmail, setSendingResetEmail] = useState(false);

  const modalStateRef = useRef({
    showCompleteProfileModal,
    showEmailConfirmationModal,
    showForgotPasswordModal,
  });
  modalStateRef.current = {
    showCompleteProfileModal,
    showEmailConfirmationModal,
    showForgotPasswordModal,
  };

  const nav = navigation as NavigationProp<ParamListBase>;

  // Android: primeira abertura pode deixar `(tabs)` na pilha; limpa antes do usuário apertar Voltar.
  useLayoutEffect(() => {
    if (Platform.OS !== 'android') return;
    sanitizeLoginParentStackIfNeeded(nav);
  }, [nav]);

  // Android: na tela de login não deve existir “voltar” para agenda/tabs; Voltar sai do app.
  // Se algum modal estiver aberto, fecha o modal em vez de sair.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') {
        return undefined;
      }
      sanitizeLoginParentStackIfNeeded(nav);
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        const m = modalStateRef.current;
        if (m.showCompleteProfileModal) {
          setShowCompleteProfileModal(false);
          return true;
        }
        if (m.showEmailConfirmationModal) {
          setShowEmailConfirmationModal(false);
          return true;
        }
        if (m.showForgotPasswordModal) {
          setShowForgotPasswordModal(false);
          return true;
        }
        BackHandler.exitApp();
        return true;
      });
      return () => sub.remove();
    }, [nav])
  );

  // O Stack nativo processa POP antes de handlers genéricos: bloqueia voltar para rota anterior (ex.: agenda).
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      const type = (e.data as { action?: { type?: string } }).action?.type;
      if (type === 'REPLACE' || type === 'RESET' || type === 'NAVIGATE' || type === 'JUMP_TO') {
        return;
      }
      if (type === 'POP' || type === 'GO_BACK') {
        e.preventDefault();
        if (Platform.OS === 'android') {
          BackHandler.exitApp();
        }
      }
    });
    return sub;
  }, [navigation]);

  // Solicitar permissões ao carregar a tela de login
  useEffect(() => {
    const requestPermissions = async () => {
      if (Platform.OS === 'ios') {
        try {
          console.log('📱 [LoginScreen] Solicitando permissões de notificação...');
          const authStatus = await messaging().requestPermission();
          const enabled =
            authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
            authStatus === messaging.AuthorizationStatus.PROVISIONAL;

          if (enabled) {
            console.log('✅ [LoginScreen] Permissão de notificação concedida');
            // Registrar dispositivo para mensagens remotas
            try {
              await messaging().registerDeviceForRemoteMessages();
              console.log('✅ [LoginScreen] Dispositivo registrado para mensagens remotas');
            } catch (regError: any) {
              if (regError?.code !== 'messaging/device-already-registered') {
                console.log('⚠️ [LoginScreen] Erro ao registrar dispositivo:', regError);
              }
            }
          } else {
            console.log('⚠️ [LoginScreen] Permissão de notificação negada');
          }
        } catch (error) {
          console.error('❌ [LoginScreen] Erro ao solicitar permissões:', error);
        }
      }
    };

    requestPermissions();
  }, []);

  const getFCMToken = async () => {
    try {
      console.log('🔍 Iniciando busca do token FCM...');
      
      // No iOS, garantir que temos permissão e registro
      if (Platform.OS === 'ios') {
        console.log('📱 iOS detectado - verificando permissões...');
        
        // Verificar se já temos permissão
        const authStatus = await messaging().requestPermission();
        const hasPermission = 
          authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
          authStatus === messaging.AuthorizationStatus.PROVISIONAL;

        if (!hasPermission) {
          console.log('⚠️ Permissão de notificação não concedida');
          // Não mostrar modal se não tiver permissão
          return;
        }

        console.log('✅ Permissão concedida, registrando dispositivo...');
        
        // Registrar dispositivo para mensagens remotas
        try {
          await messaging().registerDeviceForRemoteMessages();
          console.log('✅ Dispositivo registrado, aguardando processamento...');
          // Aguardar para garantir que o registro foi processado
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (regError: any) {
          // Se já estiver registrado, pode dar erro, mas continuamos
          if (regError?.code === 'messaging/device-already-registered') {
            console.log('✅ Dispositivo já estava registrado');
          } else {
            console.log('⚠️ Erro ao registrar dispositivo:', regError);
            // Continuar mesmo assim, pode funcionar
          }
        }
      }
      
      // Obter o token
      console.log('🔑 Obtendo token FCM...');
      const token = await messaging().getToken();
      
      if (token) {
        console.log('✅ Token FCM obtido com sucesso!');
        const { user } = await getCurrentUser();
        if (user) {
          const saveResult = await saveFCMToken(user.id, token);
          if (saveResult.success) {
            console.log('✅ Token FCM salvo no banco de dados!');
          } else {
            console.error('❌ Erro ao salvar token FCM:', saveResult.error);
          }
        }
      } else {
        console.log('⚠️ Token FCM não disponível');
        // Não mostrar modal se não obteve token
      }
    } catch (error: any) {
      console.error('❌ Erro ao obter token FCM:', error);
      console.error('❌ Código do erro:', error?.code);
      console.error('❌ Mensagem do erro:', error?.message);
      
      // Se o erro for de não registrado, tentar registrar novamente
      if (error?.code === 'messaging/unregistered' && Platform.OS === 'ios') {
        console.log('🔄 Erro: dispositivo não registrado. Tentando registrar novamente...');
        try {
          await messaging().registerDeviceForRemoteMessages();
          console.log('✅ Registrado novamente, aguardando...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const token = await messaging().getToken();
          if (token) {
            console.log('✅ Token FCM obtido após novo registro!');
            const { user } = await getCurrentUser();
            if (user) {
              const saveResult = await saveFCMToken(user.id, token);
              if (saveResult.success) {
                console.log('✅ Token FCM salvo no banco de dados!');
              } else {
                console.error('❌ Erro ao salvar token FCM:', saveResult.error);
              }
            }
            return;
          }
        } catch (retryError: any) {
          console.error('❌ Erro ao tentar novamente:', retryError);
          console.error('❌ Código do erro (retry):', retryError?.code);
        }
      }
      
      console.log('⚠️ Não foi possível obter o token FCM');
    }
  };

  const handleAppleSuccess = async ({ user, credentialEmail, credentialFullName, isNewUser }: AppleSignInResult) => {
    setLoading(true);
    try {
      const appleFullName = credentialFullName
        ? [credentialFullName.givenName, credentialFullName.middleName, credentialFullName.familyName]
            .filter(Boolean)
            .join(' ')
            .trim()
        : '';

      const storedName =
        (user.user_metadata?.full_name as string | undefined) ||
        (user.user_metadata?.name as string | undefined) ||
        '';

      const finalName = appleFullName || storedName;
      const displayName = (finalName || credentialEmail || 'Usuário').trim();
      const emailToPersist = credentialEmail || user.email || '';

      const result = await createOrUpdateUserFromApple(user.id, {
        name: displayName || 'Usuário',
        email: emailToPersist,
        photo:
          user.user_metadata?.avatar_url ||
          user.user_metadata?.picture ||
          undefined,
      });

      if (!result.success) {
        throw new Error(result.error || 'Erro ao salvar o usuário Apple');
      }

      if (isNewUser) {
        getFCMToken().catch(() => {});
        router.replace({ pathname: '/(tabs)/agenda', params: { showNewUserModal: '1' } });
        return;
      }

      getFCMToken().catch((error) => {
        console.error('Erro ao buscar token FCM:', error);
      });

      // Verificar artistas e redirecionar adequadamente
      const { shouldRedirectToSelection, activeArtist: artistToSet } = await checkArtistsAndRedirect();
      if (artistToSet) await setActiveArtist(artistToSet);

      setTimeout(() => {
        if (shouldRedirectToSelection) {
          router.replace('/selecionar-artista');
        } else {
          router.replace('/(tabs)/agenda');
        }
      }, 100);
    } finally {
      setLoading(false);
    }
  };

  const handleAppleError = (error: Error) => {
    console.error('Erro no login com Apple:', error);
    Alert.alert('Erro', error?.message || 'Não foi possível autenticar com a Apple');
  };

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();

      if (response.type === 'success') {
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: response.data.idToken || '',
        });

        if (error) {
          Alert.alert('Erro', error.message);
          return;
        }

        if (data?.user) {
          const result = await createOrUpdateUserFromGoogle(
            data.user.id,
            {
              name: (response.data.user.name || response.data.user.email || 'Usuário').trim(),
              email: response.data.user.email || '',
              photo: response.data.user.photo || undefined,
            }
          );

          if (result.isNewUser) {
            getFCMToken().catch(() => {});
            router.replace({ pathname: '/(tabs)/agenda', params: { showNewUserModal: '1' } });
          } else {
            getFCMToken().catch((error) => {
              console.error('Erro ao buscar token FCM:', error);
            });
            
            // Verificar artistas e redirecionar adequadamente
            const { shouldRedirectToSelection, activeArtist: artistToSet } = await checkArtistsAndRedirect();
            if (artistToSet) await setActiveArtist(artistToSet);
            
            setTimeout(() => {
              if (shouldRedirectToSelection) {
                router.replace('/selecionar-artista');
              } else {
                router.replace('/(tabs)/agenda');
              }
            }, 100);
          }
        }
      }
    } catch (error: any) {
      const code = error?.code ?? '';
      const msg = error?.message ?? '';
      if (code === statusCodes.IN_PROGRESS) {
        Alert.alert('Atenção', 'Login já em andamento');
      } else if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert('Erro', 'Google Play Services não disponível');
      } else if (code === statusCodes.SIGN_IN_CANCELLED) {
        // Usuário cancelou, não mostrar alerta
      } else if (Platform.OS === 'android' && (code === '10' || String(msg).includes('DEVELOPER_ERROR'))) {
        console.error('Login Google Android (config):', code, msg);
        Alert.alert(
          'Erro de configuração (Android)',
          'Login com Google não está configurado para este app. No Google Cloud Console (APIs & Services > Credentials) crie um cliente OAuth 2.0 do tipo Android com:\n\n• Nome do pacote: com.marcaaipro.app\n• SHA-1 do seu keystore (veja o guia no projeto: GOOGLE_LOGIN_ANDROID.md)'
        );
      } else if (code === '8' || String(msg).toUpperCase().includes('INTERNAL_ERROR')) {
        console.error('Login Google INTERNAL_ERROR:', code, msg, error);
        Alert.alert(
          'Erro de configuração',
          'Falha interna no login com Google. Geralmente é pacote ou SHA-1 incorretos no Google Cloud, ou google-services.json ausente/incorreto.\n\nConfira o guia GOOGLE_LOGIN_ANDROID.md no projeto e verifique:\n• Pacote: com.marcaaipro.app\n• SHA-1 do keystore no Console\n• google-services.json em android/app (se usar Firebase)'
        );
      } else {
        console.error('Erro no login com Google:', { code, message: msg, error });
        Alert.alert('Erro', msg || 'Erro ao fazer login com Google');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Erro', 'Por favor, preencha todos os campos');
      return;
    }

    setLoading(true);
    try {
      const result = await loginUser(email, password);
      
      if (result.error) {
        const errorMsg = result.error.message?.toLowerCase() || '';
        if (maybeShowConnectionError(null, result.error.message)) {
          /* modal global */
        } else if (errorMsg.includes('email não confirmado') || errorMsg.includes('email not confirmed')) {
          // Apenas mostrar modal de confirmação de email se o erro for especificamente sobre isso
          setEmailConfirmationError(result.error.message);
          setShowEmailConfirmationModal(true);
        } else {
          // Para outros erros (senha incorreta, etc), mostrar Alert simples
          Alert.alert('Erro', result.error.message);
        }
      } else if (result.data?.user) {
        if (result.data.user.email_confirmed_at) {
          const userCheck = await checkUserExists(result.data.user.id);

          if (userCheck.error) {
            if (!maybeShowConnectionError(null, userCheck.error)) {
              Alert.alert('Atenção', 'Erro ao verificar dados do usuário');
            }
            return;
          }
          
          if (!userCheck.exists) {
            setShowCompleteProfileModal(true);
          } else {
            // Buscar token FCM e mostrar modal (não navegar ainda, o modal vai aparecer)
            getFCMToken().catch((error) => {
              console.error('Erro ao buscar token FCM:', error);
            });
            
            // Verificar artistas e redirecionar adequadamente
            const { shouldRedirectToSelection, activeArtist: artistToSet } = await checkArtistsAndRedirect();
            
            // Se tinha apenas 1 artista, já foi salvo no AsyncStorage; atualizar o contexto para a agenda usar
            if (artistToSet) {
              await setActiveArtist(artistToSet);
            }
            
            // Navegar após um pequeno delay para garantir que o modal apareça
            setTimeout(() => {
              if (shouldRedirectToSelection) {
                router.replace('/selecionar-artista');
              } else {
                router.replace('/(tabs)/agenda');
              }
            }, 100);
          }
        } else {
          Alert.alert('Atenção', 'Erro ao verificar dados do usuário');
        }
      }
    } catch (error: unknown) {
      if (!maybeShowConnectionError(error)) {
        Alert.alert('Atenção', 'Ocorreu um erro inesperado');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendEmail = async () => {
    if (!email.trim()) {
      Alert.alert('Erro', 'Por favor, preencha o campo de email');
      return;
    }

    setResendingEmail(true);
    try {
      const result = await resendConfirmationEmail(email);
      
      if (result.error) {
        Alert.alert('Erro', result.error);
      } else {
        Alert.alert(
          'Sucesso',
          'Email de confirmação reenviado! Verifique sua caixa de entrada.',
          [
            {
              text: 'OK',
              onPress: () => setShowEmailConfirmationModal(false),
            },
          ]
        );
      }
    } catch {
      Alert.alert('Erro', 'Ocorreu um erro ao reenviar o email');
    } finally {
      setResendingEmail(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!resetEmail.trim()) {
      Alert.alert('Erro', 'Por favor, preencha o campo de email');
      return;
    }

    setSendingResetEmail(true);
    try {
      const result = await sendPasswordResetEmail(resetEmail);
      
      if (result.error) {
        Alert.alert('Erro', result.error);
      } else {
        Alert.alert(
          'Email Enviado',
          'Enviamos um link de recuperação para seu email. Verifique sua caixa de entrada e spam.',
          [
            {
              text: 'OK',
              onPress: () => {
                setShowForgotPasswordModal(false);
                setResetEmail('');
              },
            },
          ]
        );
      }
    } catch {
      Alert.alert('Erro', 'Ocorreu um erro ao enviar o email');
    } finally {
      setSendingResetEmail(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
      >
        <ScrollView contentContainerStyle={styles.scrollContainer}>
          <View style={styles.content}>
            {/* Logo/Header */}
            <View style={styles.header}>
              <MeuShowWordmark size="md" />
              <Text style={[styles.brandTagline, { color: colors.textSecondary }]}>
                Agenda & Finanças
              </Text>
            </View>

            {/* Formulário de Login */}
            <View style={[styles.form, { backgroundColor: colors.surface }]}>
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Email</Text>
                <View style={[styles.inputContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Ionicons name="mail-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: colors.text }]}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="Digite seu email"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Senha</Text>
                <View style={[styles.inputContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: colors.text }]}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Digite sua senha"
                    placeholderTextColor={colors.textSecondary}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.eyeIcon}
                  >
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity 
                style={styles.forgotPassword}
                onPress={() => {
                  setResetEmail(email); // Preencher com o email digitado
                  setShowForgotPasswordModal(true);
                }}
              >
                <Text style={[styles.forgotPasswordText, { color: colors.primary }]}>Esqueceu sua senha?</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.loginButton, { backgroundColor: colors.primary }, loading && styles.loginButtonDisabled]}
                onPress={handleLogin}
                disabled={loading}
              >
                <Text style={styles.loginButtonText}>
                  {loading ? 'Entrando...' : 'Entrar'}
                </Text>
              </TouchableOpacity>

              <View style={styles.divider}>
                <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                <Text style={[styles.dividerText, { color: colors.textSecondary }]}>ou</Text>
                <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              </View>

              <TouchableOpacity
                style={[
                  styles.googleButton,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    shadowColor: colors.shadow,
                  },
                  loading && styles.socialButtonDisabled,
                ]}
                onPress={handleGoogleLogin}
                disabled={loading}
              >
                <GoogleGLogo size={22} />
                <Text style={[styles.googleButtonText, { color: colors.text }]}>Entrar com Google</Text>
              </TouchableOpacity>

              {Platform.OS === 'ios' && (
                <AppleSignInButton
                  disabled={loading}
                  onSuccess={handleAppleSuccess}
                  onError={handleAppleError}
                  style={[styles.appleButton, loading && styles.socialButtonDisabled]}
                />
              )}

              <View style={styles.signupContainer}>
                <Text style={[styles.signupText, { color: colors.textSecondary }]}>Não tem uma conta? </Text>
                <TouchableOpacity onPress={() => router.push('/register')}>
                  <Text style={[styles.signupLink, { color: colors.primary }]}>Cadastre-se</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Modal para completar cadastro */}
      {showCompleteProfileModal && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalIcon, { backgroundColor: colors.background }]}>
                <Ionicons name="person-add" size={32} color={colors.primary} />
              </View>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Complete seu Cadastro</Text>
              <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
                Você precisa finalizar seu perfil pessoal para continuar. Se cancelar agora, sua sessão será encerrada.
              </Text>
            </View>

            {/* Fluxo de cadastro visual */}
            <View style={styles.modalFlowContainer}>
              <View style={styles.modalFlowStep}>
                <View style={[styles.modalFlowIcon, { backgroundColor: colors.primary }]}>
                  <Ionicons name="person" size={20} color="#fff" />
                </View>
                <Text style={[styles.modalFlowText, { color: colors.primary, fontWeight: 'bold' }]}>
                  Perfil Pessoal
                </Text>
                <Text style={[styles.modalFlowDescription, { color: colors.textSecondary }]}>
                  Nome, telefone, cidade
                </Text>
              </View>

              <View style={styles.modalFlowArrow}>
                <Ionicons name="arrow-forward" size={20} color={colors.textSecondary} />
              </View>

              <View style={styles.modalFlowStep}>
                <View style={[styles.modalFlowIcon, { backgroundColor: colors.border }]}>
                  <Ionicons name="musical-notes" size={20} color={colors.textSecondary} />
                </View>
                <Text style={[styles.modalFlowText, { color: colors.textSecondary }]}>
                  Perfil Artista
                </Text>
                <Text style={[styles.modalFlowDescription, { color: colors.textSecondary }]}>
                  Nome artístico, foto
                </Text>
              </View>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalCancelButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                onPress={async () => {
                  setShowCompleteProfileModal(false);
                  await logoutUser();
                }}
              >
                <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalContinueButton, { backgroundColor: colors.primary }]}
                onPress={() => {
                  setShowCompleteProfileModal(false);
                  router.replace('/cadastro-usuario');
                }}
              >
                <Text style={styles.modalContinueText}>Continuar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Modal de Confirmação de Email */}
      <Modal
        visible={showEmailConfirmationModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEmailConfirmationModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalIcon, { backgroundColor: isDarkMode ? 'rgba(244, 67, 54, 0.15)' : 'rgba(244, 67, 54, 0.1)' }]}>
                <Ionicons name="mail-unread-outline" size={40} color="#F44336" />
              </View>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Email não confirmado
              </Text>
              <Text style={[styles.modalSubtitle, { color: colors.textSecondary, marginTop: 8 }]}>
                {emailConfirmationError}
              </Text>
            </View>

            {/* Informação adicional */}
            <View style={[styles.emailInfoContainer, { backgroundColor: isDarkMode ? 'rgba(102, 126, 234, 0.1)' : 'rgba(102, 126, 234, 0.05)' }]}>
              <Ionicons name="information-circle-outline" size={20} color={colors.primary} />
              <Text style={[styles.emailInfoText, { color: colors.textSecondary }]}>
                Verifique sua caixa de entrada e spam. Caso não tenha recebido, você pode solicitar um novo email.
              </Text>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalCancelButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                onPress={() => setShowEmailConfirmationModal(false)}
                disabled={resendingEmail}
              >
                <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Fechar</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[
                  styles.modalContinueButton, 
                  { backgroundColor: resendingEmail ? colors.border : colors.primary },
                ]}
                onPress={handleResendEmail}
                disabled={resendingEmail}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="mail-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.modalContinueText}>
                    {resendingEmail ? 'Enviando...' : 'Reenviar Email'}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal de Esqueceu a Senha */}
      <Modal
        visible={showForgotPasswordModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowForgotPasswordModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalIcon, { backgroundColor: isDarkMode ? 'rgba(102, 126, 234, 0.15)' : 'rgba(102, 126, 234, 0.1)' }]}>
                <Ionicons name="key-outline" size={40} color={colors.primary} />
              </View>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Esqueceu sua senha?
              </Text>
              <Text style={[styles.modalSubtitle, { color: colors.textSecondary, marginTop: 8 }]}>
                Digite seu email e enviaremos um link para redefinir sua senha
              </Text>
            </View>

            {/* Campo de email */}
            <View style={styles.forgotPasswordEmailContainer}>
              <Text style={[styles.label, { color: colors.text, marginBottom: 8 }]}>Email</Text>
              <View style={[styles.inputContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <Ionicons name="mail-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  value={resetEmail}
                  onChangeText={setResetEmail}
                  placeholder="Digite seu email"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!sendingResetEmail}
                />
              </View>
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalCancelButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                onPress={() => {
                  setShowForgotPasswordModal(false);
                  setResetEmail('');
                }}
                disabled={sendingResetEmail}
              >
                <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Cancelar</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[
                  styles.modalContinueButton, 
                  { backgroundColor: sendingResetEmail ? colors.border : colors.primary },
                ]}
                onPress={handleForgotPassword}
                disabled={sendingResetEmail}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="send-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.modalContinueText}>
                    {sendingResetEmail ? 'Enviando...' : 'Enviar Link'}
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    marginTop: 8,
  },
  brandTagline: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '500',
  },
  form: {
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.1,
    shadowRadius: Platform.OS === 'android' ? 0 : 8,
    elevation: Platform.OS === 'android' ? 0 : 8,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
  },
  inputIcon: {
    marginLeft: 16,
  },
  input: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  eyeIcon: {
    padding: 16,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 24,
  },
  forgotPasswordText: {
    fontSize: 14,
    fontWeight: '500',
  },
  loginButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  loginButtonDisabled: {
    backgroundColor: '#ccc',
  },
  loginButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 14,
    flexShrink: 0,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    height: 56,
    marginBottom: Platform.OS === 'ios' ? 12 : 24,
    borderWidth: 1,
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.1,
    shadowRadius: Platform.OS === 'android' ? 0 : 2,
    elevation: Platform.OS === 'android' ? 0 : 2,
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 10,
  },
  appleButton: {
    width: '100%',
    height: 54,
    marginBottom: 24,
  },
  socialButtonDisabled: {
    opacity: 0.55,
  },
  signupContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  signupText: {
    fontSize: 14,
  },
  signupLink: {
    fontSize: 14,
    fontWeight: '600',
  },
  // Estilos do modal
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalContainer: {
    borderRadius: 20,
    padding: 24,
    marginHorizontal: 20,
    maxWidth: 400,
    width: '90%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.25,
    shadowRadius: Platform.OS === 'android' ? 0 : 20,
    elevation: Platform.OS === 'android' ? 0 : 10,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  modalIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  modalFlowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  modalFlowStep: {
    alignItems: 'center',
    flex: 1,
    minWidth: 100,
  },
  modalFlowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalFlowText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
  },
  modalFlowDescription: {
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 14,
  },
  modalFlowArrow: {
    marginHorizontal: 8,
    alignItems: 'center',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalCancelButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  modalCancelText: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalContinueButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalContinueText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  emailInfoContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  emailInfoText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  forgotPasswordEmailContainer: {
    marginBottom: 24,
  },
});