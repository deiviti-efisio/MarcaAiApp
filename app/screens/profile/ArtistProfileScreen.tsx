import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ESTADOS_BRASIL, normalizeEstadoParaListaExibicao } from '../../../constants/estadosBrasil';
import {
    ARTIST_SHOW_FORMAT_PRESETS,
    ARTIST_WORK_ROLE_PRESETS,
    buildOrderedOptionsForPicker,
    normalizeShowFormats,
} from '../../../constants/artistProfileLists';
import { useActiveArtistContext } from '../../../contexts/ActiveArtistContext';
import { useTheme } from '../../../contexts/ThemeContext';
import { createArtist } from '../../../services/supabase/artistService';
import { getCurrentUser } from '../../../services/supabase/authService';
import { uploadImageToSupabase } from '../../../services/supabase/imageUploadService';
import { canCreateArtist, FREE_PLAN_MAX_OWNED_ARTIST_PROFILES, getUserProfile } from '../../../services/supabase/userService';
import { ChipMultiSelectField } from '../../../components/ChipMultiSelectField';
import BrazilPlaceSearchField from '../../../components/BrazilPlaceSearchField';
import { isCompleteBrazilMobile, maskBrazilMobile } from '../../../utils/brazilPhone';

const estilosMusicais = [
  'Alternative',
  'Arrocha',
  'Artista Solo',
  'Axé',
  'Baião',
  'Bailão',
  'Bandas do Sul',
  'Bandinhas',
  'Blues',
  'Bossa Nova',
  'Brega',
  'Choro',
  'Country',
  'DJ',
  'Eletrônica',
  'Emo',
  'Folk',
  'Forró',
  'Forró Eletrônico',
  'Frevo',
  'Funk',
  'Funk Carioca',
  'Funk Melody',
  'Gospel',
  'Gospel Contemporâneo',
  'Hard Rock',
  'Hip Hop',
  'House',
  'Indie',
  'Instrumental',
  'Jazz',
  'Maracatu',
  'Metal',
  'MPB',
  'Música Clássica',
  'Música Gaúcha',
  'Pagode',
  'Piseiro',
  'Pop',
  'Pop Rock',
  'Punk',
  'R&B',
  'Rap',
  'Reggae',
  'Reggaeton',
  'Rock',
  'Rock Nacional',
  'Samba',
  'Samba Rock',
  'Sertanejo',
  'Sertanejo Raiz',
  'Sertanejo Universitário',
  'Ska',
  'Soul',
  'Techno',
  'Tradicionalista',
  'Trap',
  'Vanera',
  'Xote',
  'Outros'
];

export default function ArtistProfileScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{
    fromSettings?: string;
    secondary?: string;
    onboarding?: string;
    nome?: string;
  }>();
  const fromSettings = params.fromSettings === 'true';
  /** Fluxo “mais um artista” (ex.: agenda) — mesmo formulário, com voltar/cancelar sem alerta de onboarding. */
  const fromSecondary = params.secondary === 'true';
  const fromOnboarding = params.onboarding === 'true';
  const hasBackNavigation = fromSettings || fromSecondary;
  const isFirstOnboarding = fromOnboarding || (!fromSettings && !fromSecondary);
  const { setActiveArtist } = useActiveArtistContext();
  
  const [name, setName] = useState(
    typeof params.nome === 'string' ? params.nome.trim() : ''
  );
  const [musicalStyle, setMusicalStyle] = useState('');
  const [bio, setBio] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [showEmailOnProfile, setShowEmailOnProfile] = useState(false);
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [isAvailableForGigs, setIsAvailableForGigs] = useState(false);
  const [showWhatsappInSearch, setShowWhatsappInSearch] = useState(false);
  const [averageCacheValue, setAverageCacheValue] = useState('');
  const [selectedWorkRoles, setSelectedWorkRoles] = useState<string[]>([]);
  const [selectedShowFormats, setSelectedShowFormats] = useState<string[]>([]);
  const [profileUrl, setProfileUrl] = useState<string | null>(null);
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showEstilos, setShowEstilos] = useState(false);
  const [showEstados, setShowEstados] = useState(false);
  const [workRoleDraft, setWorkRoleDraft] = useState('');
  const [showFormatDraft, setShowFormatDraft] = useState('');
  const [createdArtistName, setCreatedArtistName] = useState('');
  const [photoSkippedWarning, setPhotoSkippedWarning] = useState(false);

  const formatCurrencyInput = (raw: string): string => {
    const digitsOnly = raw.replace(/\D/g, '');
    if (!digitsOnly) return '';
    const numericValue = Number(digitsOnly) / 100;
    return numericValue.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const parseCurrencyInputToNumber = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/\./g, '').replace(',', '.');
    const numericValue = Number(normalized);
    return Number.isNaN(numericValue) ? null : numericValue;
  };

  const workRoleOptions = buildOrderedOptionsForPicker(ARTIST_WORK_ROLE_PRESETS, selectedWorkRoles);
  const showFormatOptions = buildOrderedOptionsForPicker(ARTIST_SHOW_FORMAT_PRESETS, selectedShowFormats);

  const toggleWorkRole = (label: string) => {
    setSelectedWorkRoles((prev) =>
      prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label]
    );
  };

  const toggleShowFormat = (label: string) => {
    setSelectedShowFormats((prev) =>
      prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label]
    );
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { user } = await getCurrentUser();
      if (!user || cancelled) return;
      const { profile } = await getUserProfile(user.id);
      if (!profile || cancelled) return;
      if (profile.city?.trim()) setCity((prev) => prev || profile.city!.trim());
      if (profile.state?.trim()) {
        setState((prev) => prev || normalizeEstadoParaListaExibicao(profile.state));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const addCustomWorkRole = () => {
    const t = workRoleDraft.trim();
    if (!t) return;
    const dup = selectedWorkRoles.some((x) => x.toLowerCase() === t.toLowerCase());
    if (dup) {
      Alert.alert('Atenção', 'Esta função já está na lista.');
      return;
    }
    setSelectedWorkRoles((prev) => [...prev, t]);
    setWorkRoleDraft('');
  };

  const addCustomShowFormat = () => {
    const t = showFormatDraft.trim();
    if (!t) return;
    const dup = selectedShowFormats.some((x) => x.toLowerCase() === t.toLowerCase());
    if (dup) {
      Alert.alert('Atenção', 'Este formato já está na lista.');
      return;
    }
    const next = normalizeShowFormats([...selectedShowFormats, t]);
    if (next.length === selectedShowFormats.length) {
      Alert.alert('Atenção', 'Use formação de palco (solo, duo, banda…), não o tipo de festa.');
      return;
    }
    setSelectedShowFormats(next);
    setShowFormatDraft('');
  };

  const handleSkipArtistCreation = () => {
    router.replace('/(tabs)/agenda');
  };

  const pickImage = async () => {
    try {
      console.log('🖼️ Iniciando seleção de imagem do artista...');
      
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
    if (!name.trim()) {
      Alert.alert('Erro', 'Por favor, preencha o nome do artista');
      return;
    }

    if (!isFirstOnboarding && !musicalStyle) {
      Alert.alert('Atenção', 'Por favor, selecione o estilo musical');
      return;
    }

    if (name.trim().length > 50) {
      Alert.alert('Atenção', 'O nome do artista deve ter no máximo 50 caracteres');
      return;
    }

    const parsedAverageCacheValue = parseCurrencyInputToNumber(averageCacheValue);
    if (isAvailableForGigs && averageCacheValue.trim() !== '' && parsedAverageCacheValue === null) {
      Alert.alert('Atenção', 'Informe um valor numérico válido para o cachê médio');
      return;
    }

    if (!city.trim() || !state.trim()) {
      Alert.alert('Atenção', 'Informe cidade e estado. A busca de artistas usa o estado do perfil.');
      return;
    }

    if (isAvailableForGigs) {
      if (!isCompleteBrazilMobile(whatsapp)) {
        Alert.alert('Atenção', 'Informe o WhatsApp com DDD, no formato (00) 00000-0000.');
        return;
      }
    }

    const emailTrim = email.trim();
    if (emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      Alert.alert('Atenção', 'Informe um e-mail válido.');
      return;
    }
    if (showEmailOnProfile && !emailTrim) {
      Alert.alert('Atenção', 'Informe o e-mail para exibir no perfil.');
      return;
    }

    setLoading(true);
    try {
      // Obter o usuário atual
      const { user, error: userError } = await getCurrentUser();
      
      if (userError || !user) {
        Alert.alert('Erro', 'Usuário não encontrado. Faça login novamente.');
        return;
      }

      // Verificar se o usuário pode criar mais artistas
      console.log('🔍 [ArtistProfileScreen] Verificando se pode criar artista...');
      const { canCreate, error: canCreateError, ownedAsAdminCount, isPremium } = await canCreateArtist(user.id);

      if (canCreateError) {
        console.error('❌ [ArtistProfileScreen] Erro ao verificar permissões:', canCreateError);
        Alert.alert('Erro', 'Erro ao verificar permissões: ' + canCreateError);
        setLoading(false);
        return;
      }

      if (!canCreate) {
        setLoading(false);
        Alert.alert(
          'Limite do plano gratuito',
          isPremium
            ? 'Não foi possível criar um novo perfil agora. Tente novamente.'
            : `Você já tem ${ownedAsAdminCount} perfil(is) de artista como administrador (máximo ${FREE_PLAN_MAX_OWNED_ARTIST_PROFILES} no gratuito). Assine o Premium para criar perfis ilimitados.`,
          [
            { text: 'OK', style: 'cancel' },
            { text: 'Ver Premium', onPress: () => router.push('/assine-premium') },
          ],
        );
        return;
      }

      console.log('✅ [ArtistProfileScreen] Usuário pode criar artista!');

      let finalProfileUrl = null;
      let photoFailed = false;

      if (selectedImageUri) {
        setIsUploadingImage(true);
        const uploadResult = await uploadImageToSupabase(selectedImageUri, 'image_artists');
        if (uploadResult.success && uploadResult.url) {
          finalProfileUrl = uploadResult.url;
        } else {
          photoFailed = true;
        }
        setIsUploadingImage(false);
      }

      const { success, error, artist } = await createArtist({
        name: name.trim(),
        musical_style: musicalStyle || undefined,
        bio: bio.trim() || null,
        profile_url: finalProfileUrl || undefined,
        user_id: user.id,
        whatsapp: isAvailableForGigs ? maskBrazilMobile(whatsapp) || undefined : undefined,
        email: emailTrim || undefined,
        show_email: showEmailOnProfile && Boolean(emailTrim),
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        is_available_for_gigs: isAvailableForGigs,
        show_whatsapp: isAvailableForGigs && showWhatsappInSearch,
        average_cache_value: isAvailableForGigs ? parsedAverageCacheValue : null,
        work_roles: isAvailableForGigs ? selectedWorkRoles : [],
        show_formats: isAvailableForGigs ? normalizeShowFormats(selectedShowFormats) : [],
      });

      console.log('📊 [ArtistProfileScreen] Resposta do createArtist:', {
        success,
        error,
        artist
      });

      if (!success || !artist) {
        console.error('❌ [ArtistProfileScreen] Falha ao criar artista:', error);
        Alert.alert('Atenção', error || 'Não foi possível criar o perfil. Tente de novo.');
        return;
      }

      console.log('✅ [ArtistProfileScreen] Artista criado com sucesso!');
      console.log('🔵 [ArtistProfileScreen] Setando artista ativo...');

      // Automaticamente mudar para o novo artista criado (Context API)
      await setActiveArtist({
        id: artist.id,
        name: artist.name,
        role: 'admin', // Criador sempre é admin
        profile_url: finalProfileUrl || undefined,
        musical_style: artist.musical_style || musicalStyle || undefined
      });

      console.log('✅ [ArtistProfileScreen] Artista ativo definido!');
      console.log('🎉 [ArtistProfileScreen] Mostrando modal de sucesso...');

      // Mostrar modal de sucesso personalizado
      setCreatedArtistName(artist.name);
      setPhotoSkippedWarning(photoFailed);
      setShowSuccessModal(true);
    } catch (error) {
      console.error('❌ [ArtistProfileScreen] Erro inesperado:', error);
      Alert.alert('Erro', 'Ocorreu um erro ao criar o perfil do artista');
    } finally {
      setLoading(false);
    }
  };

  const handleCloseSuccessModal = () => {
    setShowSuccessModal(false);
    if (fromSettings || fromSecondary) {
      router.back();
    } else {
      router.replace('/(tabs)/agenda');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidingView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          <View style={styles.content}>
            {/* Header */}
            <View style={styles.header}>
              {hasBackNavigation && (
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={() => router.back()}
                  accessibilityRole="button"
                  accessibilityLabel="Voltar"
                >
                  <Ionicons name="arrow-back" size={24} color={colors.primary} />
                </TouchableOpacity>
              )}
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                {fromSettings || fromSecondary
                  ? 'Adicione um novo perfil de artista'
                  : fromOnboarding
                    ? 'Pode ser o nome da banda ou o seu. Dá para editar depois.'
                    : 'Configure o perfil do artista'}
              </Text>
            </View>

            {/* Formulário */}
            <View style={styles.form}>
              {/* Foto de Perfil */}
              <View style={styles.photoSection}>
                <Text style={[styles.label, { color: colors.text }]}>Foto do Artista</Text>
                <TouchableOpacity 
                  style={styles.photoContainer} 
                  onPress={pickImage}
                  disabled={isUploadingImage}
                >
                  {profileUrl ? (
                    <Image 
                      source={{ 
                        uri: `${profileUrl}${profileUrl.includes('?') ? '&' : '?'}t=${Date.now()}`,
                        cache: 'reload'
                      }} 
                      style={styles.photo} 
                    />
                  ) : (
                    <View style={[styles.photoPlaceholder, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <Ionicons name="camera" size={40} color={colors.primary} />
                      <Text style={[styles.photoText, { color: colors.primary }]}>Adicionar Foto</Text>
                    </View>
                  )}
                  {isUploadingImage && (
                    <View style={styles.uploadOverlay}>
                      <ActivityIndicator size="small" color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
              </View>

              {/* Nome do Artista */}
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Nome do Artista *</Text>
                <View style={[styles.inputContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Ionicons name="person-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: colors.text }]}
                    value={name}
                    onChangeText={setName}
                    placeholder="Digite o nome do artista"
                    placeholderTextColor={colors.textSecondary}
                    autoCapitalize="words"
                    maxLength={50}
                  />
                </View>
              </View>

              {/* Estilo Musical */}
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>
                  {isFirstOnboarding ? 'Estilo Musical' : 'Estilo Musical *'}
                </Text>
                <TouchableOpacity
                  style={[styles.inputContainer, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => setShowEstilos(true)}
                >
                  <Ionicons name="musical-note-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
                  <Text style={[
                    styles.input, 
                    { color: musicalStyle ? colors.text : colors.textSecondary }
                  ]}>
                    {musicalStyle || 'Selecione o estilo musical'}
                  </Text>
                  <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Bio</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8, lineHeight: 18 }}>
                  Um pouco sobre a carreira, o palco e o que te define.
                </Text>
                <TextInput
                  style={[
                    styles.bioInput,
                    { backgroundColor: colors.background, borderColor: colors.border, color: colors.text },
                  ]}
                  value={bio}
                  onChangeText={setBio}
                  placeholder="Ex.: Músico e compositor com 20 anos de estrada, voz e violão, repertório de MPB."
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  maxLength={600}
                />
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 6, textAlign: 'right' }}>
                  {bio.length}/600
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Cidade *</Text>
                <BrazilPlaceSearchField
                  value={city}
                  onChangeText={setCity}
                  onSelectPlace={(place) => {
                    setCity(place.city);
                    setState(place.stateName);
                    setShowEstados(false);
                  }}
                  placeholder="Buscar cidade"
                />
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 8, lineHeight: 16 }}>
                  Se a busca não aparecer, digite a cidade e escolha o estado.
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Estado *</Text>
                <TouchableOpacity
                  style={[
                    styles.estadoSelector,
                    { borderColor: colors.border, backgroundColor: colors.background },
                  ]}
                  onPress={() => setShowEstados(!showEstados)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.estadoText, { color: state ? colors.text : colors.textSecondary }]}>
                    {state || 'Selecione seu estado'}
                  </Text>
                  <Ionicons
                    name={showEstados ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
                {showEstados && (
                  <View style={[styles.estadosList, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <ScrollView style={styles.estadosScroll} nestedScrollEnabled>
                      {ESTADOS_BRASIL.map((estadoItem) => (
                        <TouchableOpacity
                          key={estadoItem}
                          style={[styles.estadoItem, { borderBottomColor: colors.border }]}
                          onPress={() => {
                            setState(estadoItem);
                            setShowEstados(false);
                          }}
                        >
                          <Text style={[styles.estadoItemText, { color: colors.text }]}>{estadoItem}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>E-mail</Text>
                <View style={[styles.inputContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Ionicons name="mail-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: colors.text }]}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="contato@email.com"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Mostrar e-mail no perfil</Text>
                <View
                  style={[
                    styles.switchRow,
                    { backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                >
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={{ color: colors.text, fontSize: 16, fontWeight: '500' }}>
                      Deixar e-mail público
                    </Text>
                  </View>
                  <Switch
                    value={showEmailOnProfile}
                    onValueChange={setShowEmailOnProfile}
                    trackColor={{ false: colors.border, true: colors.primary + '80' }}
                    thumbColor={Platform.OS === 'android' ? (showEmailOnProfile ? colors.primary : '#f4f3f4') : undefined}
                    ios_backgroundColor={colors.border}
                  />
                </View>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 8, lineHeight: 18 }}>
                  {showEmailOnProfile
                    ? 'Ligado: o e-mail aparece no perfil público.'
                    : 'Desligado: o e-mail permanece cadastrado, mas não aparece no perfil.'}
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.text }]}>Disponível para trabalhos</Text>
                <View
                  style={[
                    styles.switchRow,
                    { backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                >
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={{ color: colors.text, fontSize: 16, fontWeight: '500' }}>
                      Receber convites na busca
                    </Text>
                  </View>
                  <Switch
                    value={isAvailableForGigs}
                    onValueChange={(v) => {
                      setIsAvailableForGigs(v);
                      if (!v) setShowWhatsappInSearch(false);
                    }}
                    trackColor={{ false: colors.border, true: colors.primary + '80' }}
                    thumbColor={Platform.OS === 'android' ? (isAvailableForGigs ? colors.primary : '#f4f3f4') : undefined}
                    ios_backgroundColor={colors.border}
                  />
                </View>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 8, lineHeight: 18 }}>
                  {isAvailableForGigs
                    ? 'Ligado: seu artista aparece na busca para receber convites de participação em eventos.'
                    : 'Desligado: seu artista não aparece na busca de convites até você ligar novamente.'}
                </Text>
              </View>

              {isAvailableForGigs && (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={[styles.label, { color: colors.text }]}>WhatsApp *</Text>
                    <View style={[styles.inputContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <Ionicons name="logo-whatsapp" size={20} color={colors.textSecondary} style={styles.inputIcon} />
                      <TextInput
                        style={[styles.input, { color: colors.text }]}
                        value={whatsapp}
                        onChangeText={(text) => setWhatsapp(maskBrazilMobile(text))}
                        placeholder="(00) 00000-0000"
                        placeholderTextColor={colors.textSecondary}
                        keyboardType="phone-pad"
                        maxLength={15}
                      />
                    </View>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={[styles.label, { color: colors.text }]}>Mostrar WhatsApp na busca</Text>
                    <View
                      style={[
                        styles.switchRow,
                        { backgroundColor: colors.background, borderColor: colors.border },
                      ]}
                    >
                      <View style={{ flex: 1, paddingRight: 12 }}>
                        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '500' }}>
                          Exibir contato para quem convida
                        </Text>
                      </View>
                      <Switch
                        value={showWhatsappInSearch}
                        onValueChange={setShowWhatsappInSearch}
                        trackColor={{ false: colors.border, true: colors.primary + '80' }}
                        thumbColor={Platform.OS === 'android' ? (showWhatsappInSearch ? colors.primary : '#f4f3f4') : undefined}
                        ios_backgroundColor={colors.border}
                      />
                    </View>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 8, lineHeight: 18 }}>
                      {showWhatsappInSearch
                        ? 'Ligado: organizadores veem seu WhatsApp ao buscar artistas para convite.'
                        : 'Desligado: o número continua salvo, mas não aparece na busca de convites.'}
                    </Text>
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={[styles.label, { color: colors.text }]}>Cachê médio (R$)</Text>
                    <View style={[styles.inputContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <Ionicons name="cash-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
                      <Text style={[styles.currencyPrefix, { color: colors.textSecondary }]}>R$</Text>
                      <TextInput
                        style={[styles.input, { color: colors.text }]}
                        value={averageCacheValue}
                        onChangeText={(value) => setAverageCacheValue(formatCurrencyInput(value))}
                        placeholder="Ex.: 1.500,00"
                        placeholderTextColor={colors.textSecondary}
                        keyboardType="numeric"
                      />
                    </View>
                  </View>

                  <ChipMultiSelectField
                    title="Função no palco"
                    hint="Instrumento, papel musical ou função de palco/evento (som, luz, roadie, dança)."
                    options={workRoleOptions}
                    selected={selectedWorkRoles}
                    onToggle={toggleWorkRole}
                    draft={workRoleDraft}
                    onDraftChange={setWorkRoleDraft}
                    onAddCustom={addCustomWorkRole}
                    addSectionLabel="Incluir outra função"
                    addPlaceholder="Ex.: violinista"
                    presetStrip={ARTIST_WORK_ROLE_PRESETS}
                  />

                  <ChipMultiSelectField
                    title="Como se apresenta"
                    hint="Formação do palco — o que o contratante precisa saber para encaixar o show."
                    options={showFormatOptions}
                    selected={selectedShowFormats}
                    onToggle={toggleShowFormat}
                    draft={showFormatDraft}
                    onDraftChange={setShowFormatDraft}
                    onAddCustom={addCustomShowFormat}
                    addSectionLabel="Outra formação"
                    addPlaceholder="Ex.: quarteto"
                    presetStrip={ARTIST_SHOW_FORMAT_PRESETS}
                    horizontalOnly
                  />
                </>
              )}

              <TouchableOpacity
                style={[
                  styles.finalizarButton, 
                  { backgroundColor: colors.primary },
                  loading && styles.finalizarButtonDisabled
                ]}
                onPress={handleFinalizarCadastro}
                disabled={loading}
              >
                <Text style={styles.finalizarButtonText}>
                  {loading ? 'Criando...' : 'Criar Perfil do Artista'}
                </Text>
              </TouchableOpacity>

              {isFirstOnboarding && (
                <>
                  <View style={styles.divider}>
                    <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                    <Text style={[styles.dividerText, { color: colors.textSecondary }]}>ou</Text>
                    <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                  </View>

                  <TouchableOpacity
                    style={[styles.skipButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                    onPress={handleSkipArtistCreation}
                  >
                    <Text style={[styles.skipButtonText, { color: colors.primary }]}>Criar mais tarde</Text>
                  </TouchableOpacity>
                </>
              )}

              {hasBackNavigation && (
                <>
                  <View style={styles.divider}>
                    <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                    <Text style={[styles.dividerText, { color: colors.textSecondary }]}>ou</Text>
                    <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                  </View>

                  <TouchableOpacity
                    style={[styles.skipButton, { backgroundColor: colors.background, borderColor: colors.border }]}
                    onPress={() => router.back()}
                  >
                    <Text style={[styles.skipButtonText, { color: colors.primary }]}>Cancelar</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Modal de Seleção de Estilo Musical */}
      <Modal
        visible={showEstilos}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEstilos(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowEstilos(false)}
        >
          <View 
            style={[styles.modalContent, { backgroundColor: colors.surface }]} 
            onStartShouldSetResponder={() => true}
          >
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Selecione o Estilo Musical</Text>
              <TouchableOpacity onPress={() => setShowEstilos(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalList}>
              {estilosMusicais.map((estilo) => (
                <TouchableOpacity
                  key={estilo}
                  style={[
                    styles.modalItem,
                    { borderBottomColor: colors.border },
                    musicalStyle === estilo && { backgroundColor: colors.primary + '20' }
                  ]}
                  onPress={() => {
                    setMusicalStyle(estilo);
                    setShowEstilos(false);
                  }}
                >
                  <Text style={[
                    styles.modalItemText, 
                    { color: musicalStyle === estilo ? colors.primary : colors.text }
                  ]}>
                    {estilo}
                  </Text>
                  {musicalStyle === estilo && (
                    <Ionicons name="checkmark" size={24} color={colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal de Sucesso */}
      <Modal
        visible={showSuccessModal}
        transparent
        animationType="fade"
        onRequestClose={handleCloseSuccessModal}
      >
        <View style={styles.successModalOverlay}>
          <View style={[styles.successModalContainer, { backgroundColor: colors.surface }]}>
            {/* Ícone de Sucesso Animado */}
            <View style={[styles.successIconContainer, { backgroundColor: colors.success + '15' }]}>
              <Ionicons name="checkmark-circle" size={80} color={colors.success} />
            </View>

            {/* Título */}
            <Text style={[styles.successTitle, { color: colors.text }]}>
              Artista Criado! 🎉
            </Text>

            {/* Nome do Artista */}
            <View style={[styles.artistNameCard, { backgroundColor: colors.background }]}>
              <Ionicons name="musical-notes" size={24} color={colors.primary} />
              <Text style={[styles.artistNameText, { color: colors.text }]}>
                {createdArtistName}
              </Text>
            </View>

            {/* Mensagem */}
            <Text style={[styles.successMessage, { color: colors.textSecondary }]}>
              {photoSkippedWarning
                ? 'Perfil criado. A foto não foi enviada — você pode adicionar depois em Configurações.'
                : 'O perfil do artista foi criado com sucesso! Você está agora gerenciando este artista.'}
            </Text>

            {/* Features */}
            <View style={styles.featuresList}>
              <View style={styles.featureItem}>
                <View style={[styles.featureIcon, { backgroundColor: colors.primary + '15' }]}>
                  <Ionicons name="calendar" size={16} color={colors.primary} />
                </View>
                <Text style={[styles.featureText, { color: colors.text }]}>
                  Gerencie eventos e shows
                </Text>
              </View>
              <View style={styles.featureItem}>
                <View style={[styles.featureIcon, { backgroundColor: colors.primary + '15' }]}>
                  <Ionicons name="cash" size={16} color={colors.primary} />
                </View>
                <Text style={[styles.featureText, { color: colors.text }]}>
                  Controle financeiro completo
                </Text>
              </View>
              <View style={styles.featureItem}>
                <View style={[styles.featureIcon, { backgroundColor: colors.primary + '15' }]}>
                  <Ionicons name="people" size={16} color={colors.primary} />
                </View>
                <Text style={[styles.featureText, { color: colors.text }]}>
                  Convide colaboradores
                </Text>
              </View>
            </View>

            {/* Botão Continuar */}
            <TouchableOpacity
              style={[styles.successButton, { backgroundColor: colors.primary }]}
              onPress={handleCloseSuccessModal}
            >
              <Text style={styles.successButtonText}>Continuar</Text>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </TouchableOpacity>
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
    paddingTop: 20,
    paddingBottom: 30,
  },
  header: {
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 4,
    position: 'relative',
  },
  backButton: {
    position: 'absolute',
    top: -10,
    left: -10,
    padding: 8,
    zIndex: 10,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    opacity: 0.7,
  },
  form: {
    paddingHorizontal: 4,
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
  bioInput: {
    minHeight: 110,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  currencyPrefix: {
    fontSize: 16,
    fontWeight: '600',
    marginRight: 8,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 56,
  },
  estadoSelector: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 56,
  },
  estadoText: {
    fontSize: 16,
    flex: 1,
  },
  estadosList: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 12,
    maxHeight: 200,
    overflow: 'hidden',
  },
  estadosScroll: {
    maxHeight: 200,
  },
  estadoItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  estadoItemText: {
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
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    marginHorizontal: 16,
    fontSize: 14,
  },
  skipButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
  },
  skipButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalList: {
    maxHeight: 400,
  },
  modalItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  modalItemText: {
    fontSize: 16,
    flex: 1,
    paddingRight: 12,
  },
  successModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  successModalContainer: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.3,
    shadowRadius: Platform.OS === 'android' ? 0 : 16,
    elevation: Platform.OS === 'android' ? 0 : 12,
  },
  successIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
  },
  artistNameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 20,
    gap: 12,
  },
  artistNameText: {
    fontSize: 20,
    fontWeight: '600',
  },
  successMessage: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  featuresList: {
    width: '100%',
    gap: 12,
    marginBottom: 24,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureText: {
    fontSize: 14,
    fontWeight: '500',
  },
  successButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  successButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
