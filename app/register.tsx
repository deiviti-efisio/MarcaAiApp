import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppleSignInButton, { AppleSignInResult } from '../components/AppleSignInButton';
import GoogleGLogo from '../components/GoogleGLogo';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { checkArtistsAndRedirect } from '../services/supabase/authService';
import {
    createOrUpdateUserFromApple,
    createOrUpdateUserFromGoogle,
} from '../services/supabase/userService';

export default function RegisterScreen() {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleRegister = async () => {
    if (!email || !password || !confirmPassword) {
      Alert.alert('Erro', 'Por favor, preencha todos os campos');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Erro', 'As senhas não coincidem');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Erro', 'A senha deve ter pelo menos 6 caracteres');
      return;
    }

    if (!isValidEmail(email)) {
      Alert.alert('Erro', 'Por favor, insira um email válido');
      return;
    }

    setIsLoading(true);
    
    try {
      console.log('Tentando criar conta para:', email);
      
      const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
          emailRedirectTo: 'marcaai://auth/callback'
        }
      });

      console.log('Resposta do Supabase:', { data, error });

      if (error) {
        console.error('Erro no cadastro:', error);
        Alert.alert('Erro', error.message);
      } else if (data.user) {
        console.log('Usuário criado com sucesso:', data.user);
        
         // Verificar se o email foi enviado
         if (data.user.email_confirmed_at) {
           Alert.alert('Sucesso', 'Conta criada com sucesso!');
           router.push('/cadastro-usuario');
         } else {
          Alert.alert(
            'Confirmação de Email', 
            'Um email de confirmação foi enviado para ' + email + '. Verifique sua caixa de entrada e clique no link para confirmar sua conta.'
          );
          // Navegar para tela de confirmação de email
          router.push({
            pathname: '/email-confirmation',
            params: { email: email }
          });
         }
      }
    } catch (error) {
      console.error('Erro geral:', error);
      Alert.alert('Erro', 'Erro ao criar conta. Tente novamente.');
    } finally {
      setIsLoading(false);
    }
  };

  const isValidEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleGoogleLogin = async () => {
    try {
      setIsLoading(true);
      
      // Carregar GoogleSignin dinamicamente para evitar problemas no modo Bridgeless
      const { GoogleSignin, statusCodes } = await import('@react-native-google-signin/google-signin');
      
      // Configurar Google Sign-In: webClientId obrigatório (Android + Supabase). iosClientId só no iOS.
      GoogleSignin.configure({
        webClientId: '169304206053-i5bm2l2sofd011muqr66ddm2dosn5bn9.apps.googleusercontent.com',
        ...(Platform.OS === 'ios' && {
          iosClientId: '169304206053-642isf3lub3ds2thkiupcje9r7lo7dh7.apps.googleusercontent.com',
        }),
      });
      
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
            router.replace({ pathname: '/(tabs)/agenda', params: { showNewUserModal: '1' } });
          } else {
            // Usuário existente - verificar artistas e redirecionar
            const { shouldRedirectToSelection } = await checkArtistsAndRedirect();
            
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
      // Carregar statusCodes dinamicamente se necessário
      let statusCodes: any;
      try {
        const googleSignInModule = await import('@react-native-google-signin/google-signin');
        statusCodes = googleSignInModule.statusCodes;
      } catch {
        // Se não conseguir carregar, usar códigos conhecidos
        statusCodes = {
          IN_PROGRESS: '10',
          PLAY_SERVICES_NOT_AVAILABLE: '20',
          SIGN_IN_CANCELLED: '12501',
        };
      }
      
      const code = error?.code ?? '';
      const msg = error?.message ?? '';
      if (code === statusCodes.IN_PROGRESS) {
        Alert.alert('Atenção', 'Login já em andamento');
      } else if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert('Erro', 'Google Play Services não disponível');
      } else if (code === statusCodes.SIGN_IN_CANCELLED) {
        // Usuário cancelou
      } else if (Platform.OS === 'android' && (code === '10' || String(msg).includes('DEVELOPER_ERROR'))) {
        console.error('Login Google Android (config):', code, msg);
        Alert.alert(
          'Erro de configuração (Android)',
          'Login com Google não está configurado para este app. No Google Cloud Console (APIs & Services > Credentials) crie um cliente OAuth 2.0 do tipo Android com:\n\n• Nome do pacote: com.marcaaipro.app\n• SHA-1 do seu keystore (veja GOOGLE_LOGIN_ANDROID.md no projeto)'
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
      setIsLoading(false);
    }
  };

  const handleAppleSuccess = async ({ user, credentialEmail, credentialFullName, isNewUser }: AppleSignInResult) => {
    setIsLoading(true);
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
        router.replace({ pathname: '/(tabs)/agenda', params: { showNewUserModal: '1' } });
        return;
      }

      // Usuário existente - verificar artistas e redirecionar
      const { shouldRedirectToSelection } = await checkArtistsAndRedirect();

      setTimeout(() => {
        if (shouldRedirectToSelection) {
          router.replace('/selecionar-artista');
        } else {
          router.replace('/(tabs)/agenda');
        }
      }, 100);
    } catch (error: any) {
      console.error('Erro no login com Apple:', error);
      Alert.alert('Erro', error?.message || 'Erro ao fazer login com Apple');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAppleError = (error: Error) => {
    console.error('Erro no login com Apple:', error);
    Alert.alert('Erro', error?.message || 'Não foi possível autenticar com a Apple');
  };

  const dynamicStyles = createDynamicStyles(colors);

  return (
    <SafeAreaView style={[dynamicStyles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={dynamicStyles.keyboardView}
      >
        <ScrollView contentContainerStyle={dynamicStyles.scrollContent}>
          <View style={dynamicStyles.content}>
            {/* Header */}
            <View style={dynamicStyles.header}>
              <TouchableOpacity
                style={dynamicStyles.backButton}
                onPress={() => router.back()}
              >
                <Ionicons name="arrow-back" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={[dynamicStyles.brandName, { color: colors.primary }]}>MeuShow</Text>
              <Text style={[dynamicStyles.subtitle, { color: colors.textSecondary }]}>
                Preencha os dados para criar sua conta
              </Text>
            </View>

            {/* Formulário de Cadastro */}
            <View style={dynamicStyles.form}>
              <View style={[dynamicStyles.inputContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="mail-outline" size={20} color={colors.textSecondary} style={dynamicStyles.inputIcon} />
                <TextInput
                  style={[dynamicStyles.input, { color: colors.text }]}
                  placeholder="Email"
                  placeholderTextColor={colors.textSecondary}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View style={[dynamicStyles.inputContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} style={dynamicStyles.inputIcon} />
                <TextInput
                  style={[dynamicStyles.input, { color: colors.text }]}
                  placeholder="Senha"
                  placeholderTextColor={colors.textSecondary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={dynamicStyles.eyeIcon}
                >
                  <Ionicons
                    name={showPassword ? 'eye-outline' : 'eye-off-outline'}
                    size={20}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              <View style={[dynamicStyles.inputContainer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} style={dynamicStyles.inputIcon} />
                <TextInput
                  style={[dynamicStyles.input, { color: colors.text }]}
                  placeholder="Confirmar Senha"
                  placeholderTextColor={colors.textSecondary}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={dynamicStyles.eyeIcon}
                >
                  <Ionicons
                    name={showConfirmPassword ? 'eye-outline' : 'eye-off-outline'}
                    size={20}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              {/* Indicadores de validação */}
              <View style={dynamicStyles.validationContainer}>
                <View style={dynamicStyles.validationItem}>
                  <Ionicons
                    name={password.length >= 6 ? 'checkmark-circle' : 'ellipse-outline'}
                    size={16}
                    color={password.length >= 6 ? colors.success : colors.textSecondary}
                  />
                  <Text style={[
                    dynamicStyles.validationText,
                    { color: password.length >= 6 ? colors.success : colors.textSecondary }
                  ]}>
                    Mínimo 6 caracteres
                  </Text>
                </View>
                
                <View style={dynamicStyles.validationItem}>
                  <Ionicons
                    name={password === confirmPassword && password.length > 0 ? 'checkmark-circle' : 'ellipse-outline'}
                    size={16}
                    color={password === confirmPassword && password.length > 0 ? colors.success : colors.textSecondary}
                  />
                  <Text style={[
                    dynamicStyles.validationText,
                    { color: password === confirmPassword && password.length > 0 ? colors.success : colors.textSecondary }
                  ]}>
                    Senhas coincidem
                  </Text>
                </View>
                
                <View style={dynamicStyles.validationItem}>
                  <Ionicons
                    name={isValidEmail(email) ? 'checkmark-circle' : 'ellipse-outline'}
                    size={16}
                    color={isValidEmail(email) ? colors.success : colors.textSecondary}
                  />
                  <Text style={[
                    dynamicStyles.validationText,
                    { color: isValidEmail(email) ? colors.success : colors.textSecondary }
                  ]}>
                    Email válido
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={[
                  dynamicStyles.registerButton,
                  { backgroundColor: colors.primary },
                  (!isValidEmail(email) || password.length < 6 || password !== confirmPassword) && dynamicStyles.registerButtonDisabled
                ]}
                onPress={handleRegister}
                disabled={!isValidEmail(email) || password.length < 6 || password !== confirmPassword || isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={dynamicStyles.registerButtonText}>
                    Criar Conta
                  </Text>
                )}
              </TouchableOpacity>

              <View style={dynamicStyles.divider}>
                <View style={[dynamicStyles.dividerLine, { backgroundColor: colors.border }]} />
                <Text style={[dynamicStyles.dividerText, { color: colors.textSecondary }]}>ou</Text>
                <View style={[dynamicStyles.dividerLine, { backgroundColor: colors.border }]} />
              </View>

              <TouchableOpacity 
                style={[
                  dynamicStyles.googleButton,
                  isLoading && dynamicStyles.buttonDisabled
                ]}
                onPress={handleGoogleLogin}
                disabled={isLoading}
              >
                <GoogleGLogo size={20} />
                <Text style={dynamicStyles.googleButtonText}>
                  Cadastrar com Google
                </Text>
              </TouchableOpacity>

              {Platform.OS === 'ios' && (
                <AppleSignInButton
                  onSuccess={handleAppleSuccess}
                  onError={handleAppleError}
                  disabled={isLoading}
                  style={dynamicStyles.appleButton}
                />
              )}

              <View style={dynamicStyles.loginContainer}>
                <Text style={[dynamicStyles.loginText, { color: colors.textSecondary }]}>
                  Já tem uma conta?{' '}
                </Text>
                <Link href="/login" replace asChild>
                  <TouchableOpacity>
                    <Text style={[dynamicStyles.loginLink, { color: colors.primary }]}>
                      Faça login
                    </Text>
                  </TouchableOpacity>
                </Link>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createDynamicStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 30,
    paddingTop: 20,
    paddingBottom: 30,
  },
  header: {
    alignItems: 'center',
    marginBottom: 30,
    marginTop: 10,
  },
  backButton: {
    position: 'absolute',
    left: -10,
    top: 0,
    padding: 10,
    zIndex: 10,
  },
  brandName: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 6,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.7,
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 16,
    height: 56,
    borderWidth: 1,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
  },
  eyeIcon: {
    padding: 4,
  },
  validationContainer: {
    marginBottom: 24,
    paddingHorizontal: 4,
  },
  validationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  validationText: {
    fontSize: 14,
    marginLeft: 8,
  },
  registerButton: {
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: colors.shadow,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.25,
    shadowRadius: Platform.OS === 'android' ? 0 : 3.84,
    elevation: Platform.OS === 'android' ? 0 : 5,
  },
  registerButtonDisabled: {
    opacity: 0.5,
  },
  registerButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
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
    marginHorizontal: 16,
    fontSize: 14,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    height: 56,
    marginBottom: 16,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
    borderColor: '#DADCE0',
    shadowColor: '#000',
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
    fontWeight: '500',
    marginLeft: 8,
    color: '#3C4043',
  },
  appleButton: {
    marginBottom: 24,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  loginContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loginText: {
    fontSize: 14,
  },
  loginLink: {
    fontSize: 14,
    fontWeight: 'bold',
  },
});
