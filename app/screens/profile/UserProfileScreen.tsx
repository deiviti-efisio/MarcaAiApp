import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
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
import { useTheme } from '../../../contexts/ThemeContext';
import MeuShowWordmark from '../../../components/MeuShowWordmark';
import { dispatchResetToLogin } from '../../../lib/resetToLoginStack';
import { getCurrentUser } from '../../../services/supabase/authService';
import { uploadUserImage } from '../../../services/supabase/imageUploadService';
import { createUserProfile, getUserProfile } from '../../../services/supabase/userService';

const estadosBrasil = [
  'Acre', 'Alagoas', 'Amapá', 'Amazonas', 'Bahia', 'Ceará',
  'Distrito Federal', 'Espírito Santo', 'Goiás', 'Maranhão',
  'Mato Grosso', 'Mato Grosso do Sul', 'Minas Gerais', 'Pará',
  'Paraíba', 'Paraná', 'Pernambuco', 'Piauí', 'Rio de Janeiro',
  'Rio Grande do Norte', 'Rio Grande do Sul', 'Rondônia',
  'Roraima', 'Santa Catarina', 'São Paulo', 'Sergipe', 'Tocantins'
];

export default function UserProfileScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [profileUrl, setProfileUrl] = useState<string | null>(null);
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showEstados, setShowEstados] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // Pré-preencher com dados já salvos (ex.: nome/email do Sign in with Apple - não exigir que o usuário digite de novo)
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const { user, error: userError } = await getCurrentUser();
      if (userError || !user || cancelled) return;
      const { profile, error: profileError } = await getUserProfile(user.id);
      if (profileError || !profile || cancelled) {
        setProfileLoaded(true);
        return;
      }
      if (profile.name?.trim()) setName(profile.name.trim());
      if (profile.phone?.trim()) setPhone(profile.phone.trim());
      if (profile.city?.trim()) setCity(profile.city.trim());
      if (profile.state?.trim()) setState(profile.state.trim());
      if (profile.profile_url?.trim()) setProfileUrl(profile.profile_url.trim());
      setProfileLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const pickImage = async () => {
    try {
      console.log('🖼️ Iniciando seleção de imagem...');
      
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      console.log('📸 Resultado da seleção:', result);

      if (!result.canceled && result.assets[0]) {
        const imageUri = result.assets[0].uri;
        
        // Apenas salvar a URI local - upload será feito no submit
        setSelectedImageUri(imageUri);
        setProfileUrl(imageUri); // Para preview
        console.log('✅ Imagem selecionada (upload será feito no submit):', imageUri);
      } else {
        console.log('❌ Seleção cancelada pelo usuário');
      }
    } catch (error) {
      console.error('❌ Erro ao selecionar imagem:', error);
      
      try {
        const { status } = await ImagePicker.getMediaLibraryPermissionsAsync();
        
        if (status !== 'granted') {
          Alert.alert(
            'Permissão Necessária',
            'É necessário permitir o acesso à galeria para selecionar uma imagem. Vá em Configurações > Privacidade > Fotos e permita o acesso para este app.',
            [{ text: 'OK', style: 'default' }]
          );
        } else {
          Alert.alert(
            'Erro', 
            `Erro ao selecionar imagem: ${error instanceof Error ? error.message : 'Erro desconhecido'}. Tente novamente.`
          );
        }
      } catch (permError) {
        console.error('❌ Erro ao verificar permissões:', permError);
        Alert.alert(
          'Erro', 
          `Erro ao acessar galeria: ${error instanceof Error ? error.message : 'Erro desconhecido'}. Tente novamente.`
        );
      }
    }
  };

  const handleFinalizarCadastro = async () => {
    // Telefone, cidade e estado são obrigatórios. Nome não é exigido após Sign in with Apple (já fornecido pelo sistema).
    if (!phone.trim() || !city.trim() || !state) {
      Alert.alert('Erro', 'Por favor, preencha telefone, cidade e estado');
      return;
    }

    if (name.trim().length > 50) {
      Alert.alert('Atenção', 'O nome deve ter no máximo 50 caracteres');
      return;
    }

    setLoading(true);
    try {
      // Obter o usuário atual
      const { user, error: userError } = await getCurrentUser();
      
      if (userError || !user) {
        Alert.alert('Erro', 'Usuário não encontrado. Faça login novamente.');
        dispatchResetToLogin(navigation);
        return;
      }

      let finalProfileUrl = null;

      // Se há uma imagem selecionada, fazer upload agora
      if (selectedImageUri) {
        console.log('📤 Fazendo upload da imagem no momento do cadastro...');
        setIsUploadingImage(true);
        
        const uploadResult = await uploadUserImage(selectedImageUri);
        
        if (uploadResult.success && uploadResult.url) {
          finalProfileUrl = uploadResult.url;
          console.log('✅ Upload realizado com sucesso:', uploadResult.url);
        } else {
          console.error('❌ Erro no upload:', uploadResult.error);
          Alert.alert('Erro', `Erro ao fazer upload da imagem: ${uploadResult.error}`);
          setIsUploadingImage(false);
          setLoading(false);
          return;
        }
        setIsUploadingImage(false);
      }

      // Salvar os dados do usuário usando o serviço
      const { success, error } = await createUserProfile({
        id: user.id,
        name: (name.trim() || user.user_metadata?.full_name || user.user_metadata?.name || 'Usuário').trim() || 'Usuário',
        email: user.email || '',
        city: city.trim(),
        state: state,
        phone: phone.trim(),
        profile_url: finalProfileUrl
      });

      if (!success) {
        Alert.alert('Erro', 'Erro ao salvar dados do usuário: ' + error);
        return;
      }

      // Mesmo destino do fluxo Google/Apple: vai direto para a agenda com o modal de boas-vindas
      router.replace({ pathname: '/(tabs)/agenda', params: { showNewUserModal: '1' } });
    } catch (error) {
      Alert.alert('Erro', 'Ocorreu um erro ao finalizar o cadastro');
    } finally {
      setLoading(false);
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
            {/* Header */}
            <View style={styles.header}>
              <MeuShowWordmark size="sm" style={styles.brandLogo} />
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Adicione telefone e localização para continuar
              </Text>
            </View>

            {/* Formulário */}
            <View style={[styles.form, { backgroundColor: colors.surface }]}>
              {/* Foto de Perfil */}
              <View style={styles.photoSection}>
                <Text style={[styles.label, { color: colors.text }]}>Foto de Perfil</Text>
              <TouchableOpacity 
                style={styles.photoContainer} 
                onPress={pickImage}
                disabled={loading || isUploadingImage}
              >
                {profileUrl ? (
                  <Image 
                    source={{ uri: profileUrl }} 
                    style={styles.photo}
                  />
                ) : (
                  <View style={[styles.photoPlaceholder, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Ionicons name="camera" size={40} color={colors.primary} />
                    <Text style={[styles.photoText, { color: colors.primary }]}>Adicionar Foto</Text>
                  </View>
                )}
                {(isUploadingImage || loading) && (
                  <View style={styles.uploadOverlay}>
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
              </View>

              {/* Nome (já preenchido se você entrou com Apple ou Google) */}
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Nome</Text>
                <View style={[styles.inputContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Ionicons name="person-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: colors.text }]}
                    value={name}
                    onChangeText={setName}
                    placeholder="Digite seu nome completo"
                    placeholderTextColor={colors.textSecondary}
                    autoCapitalize="words"
                    maxLength={50}
                  />
                </View>
              </View>

              {/* Telefone */}
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Telefone *</Text>
                <View style={[styles.inputContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Ionicons name="call-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: colors.text }]}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="(11) 99999-9999"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="phone-pad"
                    maxLength={15}
                  />
                </View>
              </View>

              {/* Cidade */}
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Cidade *</Text>
                <View style={[styles.inputContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Ionicons name="location-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: colors.text }]}
                    value={city}
                    onChangeText={setCity}
                    placeholder="Digite sua cidade"
                    placeholderTextColor={colors.textSecondary}
                    autoCapitalize="words"
                  />
                </View>
              </View>

              {/* Estado */}
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Estado *</Text>
                <TouchableOpacity
                  style={[styles.inputContainer, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => setShowEstados(!showEstados)}
                >
                  <Ionicons name="map-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
                  <Text style={[styles.input, { color: state ? colors.text : colors.textSecondary }]}>
                    {state || 'Selecione seu estado'}
                  </Text>
                  <Ionicons
                    name={showEstados ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={colors.textSecondary}
                    style={styles.chevronIcon}
                  />
                </TouchableOpacity>

                {showEstados && (
                  <View style={[styles.estadosList, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <ScrollView style={styles.estadosScroll} nestedScrollEnabled>
                      {estadosBrasil.map((estadoItem) => (
                        <TouchableOpacity
                          key={estadoItem}
                          style={[styles.estadoItem, { borderBottomColor: colors.border }]}
                          onPress={() => {
                            setState(estadoItem);
                            setShowEstados(false);
                          }}
                        >
                          <Text style={[styles.estadoText, { color: colors.text }]}>{estadoItem}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={[styles.finalizarButton, { backgroundColor: colors.primary }, (loading || !profileLoaded) && styles.finalizarButtonDisabled]}
                onPress={handleFinalizarCadastro}
                disabled={loading || !profileLoaded}
              >
                <Text style={styles.finalizarButtonText}>
                  {loading ? 'Salvando...' : !profileLoaded ? 'Carregando...' : 'Continuar para Artista'}
                </Text>
              </TouchableOpacity>

              {/* Link para voltar ao login */}
              <TouchableOpacity
                style={styles.loginLink}
                onPress={() => dispatchResetToLogin(navigation)}
              >
                <Text style={[styles.loginLinkText, { color: colors.primary }]}>
                  Voltar ao login
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    paddingTop: 20,
    paddingBottom: 30,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 10,
  },
  brandLogo: {
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.7,
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
  photoSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  photoContainer: {
    marginTop: 10,
  },
  photo: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  photoPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoText: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '500',
  },
  uploadOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
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
    paddingHorizontal: 16,
    height: 56,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
  },
  placeholderText: {
    // Removido - agora aplicado dinamicamente
  },
  chevronIcon: {
    marginLeft: 8,
  },
  estadosList: {
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    maxHeight: 200,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.1,
    shadowRadius: Platform.OS === 'android' ? 0 : 4,
    elevation: Platform.OS === 'android' ? 0 : 4,
  },
  estadosScroll: {
    maxHeight: 200,
  },
  estadoItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  estadoText: {
    fontSize: 16,
  },
  finalizarButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  finalizarButtonDisabled: {
    backgroundColor: '#ccc',
  },
  finalizarButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  loginLink: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 8,
  },
  loginLinkText: {
    fontSize: 14,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
});
