import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ESTADOS_BRASIL, normalizeEstadoParaListaExibicao } from '../constants/estadosBrasil';
import {
  ARTIST_SHOW_FORMAT_PRESETS,
  ARTIST_WORK_ROLE_PRESETS,
  buildOrderedOptionsForPicker,
  normalizeShowFormats,
  parseArtistStringArrayFromJson,
} from '../constants/artistProfileLists';
import { ChipMultiSelectField } from '../components/ChipMultiSelectField';
import SocialMediaPreviewCard from '../components/SocialMediaPreviewCard';
import BrazilPlaceSearchField from '../components/BrazilPlaceSearchField';
import PermissionModal from '../components/PermissionModal';
import { useActiveArtistContext } from '../contexts/ActiveArtistContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  collectSocialPreviewItems,
  parseArtistSocialLinks,
  socialLinksToJson,
  isLikelyHttpUrl,
} from '../lib/socialLinks';
import { artistImageUpdateService } from '../services/artistImageUpdateService';
import { getArtistById, updateArtist } from '../services/supabase/artistService';
import { getCurrentUser } from '../services/supabase/authService';
import { deleteImageFromSupabase, extractFileNameFromUrl, uploadImageToSupabase } from '../services/supabase/imageUploadService';
import { getUserPermissions } from '../services/supabase/permissionsService';

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

export default function EditarArtistaScreen() {
  const { colors } = useTheme();
  const { activeArtist, setActiveArtist: setActiveArtistContext } = useActiveArtistContext();
  const [artist, setArtist] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [userPermissions, setUserPermissions] = useState<any>(null);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showEstilos, setShowEstilos] = useState(false);
  const [showEstados, setShowEstados] = useState(false);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  
  // Campos do formulário
  const [name, setName] = useState('');
  const [musicalStyle, setMusicalStyle] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [showEmailOnProfile, setShowEmailOnProfile] = useState(false);
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [isAvailableForGigs, setIsAvailableForGigs] = useState(true);
  const [showWhatsappInSearch, setShowWhatsappInSearch] = useState(false);
  const [averageCacheValue, setAverageCacheValue] = useState('');
  const [selectedWorkRoles, setSelectedWorkRoles] = useState<string[]>([]);
  const [selectedShowFormats, setSelectedShowFormats] = useState<string[]>([]);
  const [workRoleDraft, setWorkRoleDraft] = useState('');
  const [showFormatDraft, setShowFormatDraft] = useState('');
  const [profileUrl, setProfileUrl] = useState('');
  const [originalProfileUrl, setOriginalProfileUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [originalCoverUrl, setOriginalCoverUrl] = useState('');
  const [bio, setBio] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [spotifyUrl, setSpotifyUrl] = useState('');
  const [instagramUrl, setInstagramUrl] = useState('');
  const [extraVideos, setExtraVideos] = useState('');
  const [coverLoadError, setCoverLoadError] = useState(false);
  const formatCurrencyInput = (raw: string): string => {
    const digitsOnly = raw.replace(/\D/g, '');
    if (!digitsOnly) return '';
    const numericValue = Number(digitsOnly) / 100;
    return numericValue.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatNumberToCurrencyInput = (value: number): string =>
    value.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

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

  const addCustomWorkRole = () => {
    const t = workRoleDraft.trim();
    if (!t) return;
    if (selectedWorkRoles.some((x) => x.toLowerCase() === t.toLowerCase())) {
      Alert.alert('Atenção', 'Esta função já está na lista.');
      return;
    }
    setSelectedWorkRoles((prev) => [...prev, t]);
    setWorkRoleDraft('');
  };

  const addCustomShowFormat = () => {
    const t = showFormatDraft.trim();
    if (!t) return;
    if (selectedShowFormats.some((x) => x.toLowerCase() === t.toLowerCase())) {
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

  useEffect(() => {
    if (activeArtist) {
      loadArtistData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArtist]);

  const loadArtistData = async () => {
    try {
      setIsLoading(true);
      
      const { user, error: userError } = await getCurrentUser();
      
      if (userError || !user) {
        Alert.alert('Erro', 'Usuário não encontrado. Faça login novamente.');
        router.back();
        return;
      }

      // Verificar se há artista ativo
      if (!activeArtist) {
        Alert.alert('Erro', 'Nenhum artista ativo selecionado');
        router.back();
        return;
      }

      // Buscar dados atualizados do artista diretamente pelo ID
      const { artist: currentArtist, error: artistError } = await getArtistById(activeArtist.id);
      
      if (artistError || !currentArtist) {
        Alert.alert('Erro', 'Erro ao carregar dados do artista');
        router.back();
        return;
      }
      
      // Carregar permissões
      const permissions = await getUserPermissions(
        user.id,
        currentArtist.id
      );

      if (!permissions) {
        Alert.alert('Erro', 'Erro ao carregar permissões');
        router.back();
        return;
      }

      setUserPermissions(permissions);

      const userRole = permissions.role;
      const canEdit = userRole === 'admin';
      
      if (!canEdit || !permissions.permissions.canManageArtist) {
        Alert.alert(
          'Acesso Negado', 
          'Apenas administradores podem editar as informações do artista.',
          [
            {
              text: 'Entendi',
              onPress: () => router.back(),
            },
          ]
        );
        return;
      }

      // Se tem permissão, carregar os dados do artista
      setArtist(currentArtist);
      setName(currentArtist.name || '');
      setMusicalStyle(currentArtist.musical_style || '');
      setWhatsapp(currentArtist.whatsapp || '');
      setEmail(currentArtist.email || '');
      setShowEmailOnProfile(Boolean(currentArtist.show_email));
      setCity(currentArtist.city || '');
      setState(normalizeEstadoParaListaExibicao(currentArtist.state));
      setIsAvailableForGigs(currentArtist.is_available_for_gigs ?? true);
      setShowWhatsappInSearch(Boolean(currentArtist.show_whatsapp));
      setAverageCacheValue(
        currentArtist.average_cache_value != null
          ? formatNumberToCurrencyInput(Number(currentArtist.average_cache_value))
          : ''
      );
      setSelectedWorkRoles(parseArtistStringArrayFromJson(currentArtist.work_roles));
      setSelectedShowFormats(normalizeShowFormats(currentArtist.show_formats));
      setProfileUrl(currentArtist.profile_url || '');
      setOriginalProfileUrl(currentArtist.profile_url || '');
      setCoverUrl(currentArtist.cover_url || '');
      setOriginalCoverUrl(currentArtist.cover_url || '');
      setCoverLoadError(false);
      setBio(currentArtist.bio || '');
      const links = parseArtistSocialLinks(currentArtist.social_links);
      setYoutubeUrl(links.youtube || '');
      setSpotifyUrl(links.spotify || '');
      setInstagramUrl(links.instagram || '');
      setExtraVideos((links.videos || []).join('\n'));

    } catch {
      Alert.alert('Erro', 'Erro ao carregar dados do artista');
      router.back();
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        const imageUri = result.assets[0].uri;
        setProfileUrl(imageUri);
        setImageLoadError(false);
      }
    } catch (error) {
      try {
        const { status } = await ImagePicker.getMediaLibraryPermissionsAsync();
        
        if (status !== 'granted') {
          Alert.alert(
            'Permissão Necessária',
            'É necessário permitir o acesso à galeria para selecionar uma imagem. Vá em Configurações > Privacidade > Fotos e permita o acesso para este app.',
            [
              { text: 'OK', style: 'default' }
            ]
          );
        } else {
          Alert.alert(
            'Erro', 
            `Erro ao selecionar imagem: ${error instanceof Error ? error.message : 'Erro desconhecido'}. Tente novamente.`
          );
        }
      } catch (err) {
        Alert.alert(
          'Erro', 
          `Erro ao acessar galeria: ${err instanceof Error ? err.message : 'Erro desconhecido'}. Tente novamente.`
        );
      }
    }
  };

  const handleSelectCover = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setCoverUrl(result.assets[0].uri);
        setCoverLoadError(false);
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível selecionar a capa. Tente de novo.');
    }
  };

  const handlePressKitPress = () => {
    if (userPermissions?.role !== 'admin') {
      Alert.alert(
        'Press kit',
        'Somente o administrador do artista pode abrir o press kit.'
      );
      return;
    }
    router.push('/press-kit-artista');
  };

  const handleSave = async () => {
    if (!artist) return;

    const userRole = userPermissions?.role;
    const canEdit = userRole === 'admin';
    
    if (!canEdit || !userPermissions?.permissions.canManageArtist) {
      Alert.alert(
        'Acesso Negado',
        'Apenas administradores podem editar as informações do artista.'
      );
      return;
    }

    if (!name.trim()) {
      Alert.alert('Erro', 'Nome do artista é obrigatório');
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
      if (!whatsapp.trim()) {
        Alert.alert('Atenção', 'Informe o WhatsApp para aparecer na busca de convites.');
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

    const socialCandidates = [youtubeUrl, spotifyUrl, instagramUrl, ...extraVideos.split('\n')];
    if (socialCandidates.some((item) => item.trim() && !isLikelyHttpUrl(item))) {
      Alert.alert('Atenção', 'Confira os links de YouTube, Spotify ou Instagram.');
      return;
    }

      try {
      setIsSaving(true);
      let finalProfileUrl = profileUrl;
      let finalCoverUrl = coverUrl;

      // Se a imagem foi alterada (nova imagem selecionada)
      if (profileUrl !== originalProfileUrl && profileUrl.trim() !== '') {
        setIsUploadingImage(true);

        // Fazer upload da nova imagem para o Supabase Storage
        const uploadResult = await uploadImageToSupabase(profileUrl, 'image_artists');
        
        if (uploadResult.success && uploadResult.url) {
          finalProfileUrl = uploadResult.url;

          // Se havia uma imagem anterior, remover do storage
          if (originalProfileUrl && originalProfileUrl.trim() !== '' && !originalProfileUrl.startsWith('data:')) {
            const oldFileName = extractFileNameFromUrl(originalProfileUrl);
            if (oldFileName) {
              await deleteImageFromSupabase(oldFileName, 'image_artists');
            }
          }
        } else {
          Alert.alert('Erro', `Erro ao fazer upload da imagem: ${uploadResult.error}`);
          return;
        }
      }

      if (coverUrl !== originalCoverUrl && coverUrl.trim() !== '') {
        setIsUploadingImage(true);
        const coverUpload = await uploadImageToSupabase(coverUrl, 'image_artists');
        if (coverUpload.success && coverUpload.url) {
          finalCoverUrl = coverUpload.url;
          if (originalCoverUrl && originalCoverUrl.trim() !== '' && !originalCoverUrl.startsWith('data:')) {
            const oldCover = extractFileNameFromUrl(originalCoverUrl);
            if (oldCover) {
              await deleteImageFromSupabase(oldCover, 'image_artists');
            }
          }
        } else {
          Alert.alert('Erro', `Erro ao enviar a capa: ${coverUpload.error}`);
          return;
        }
      }

      console.log('📤 EDITAR ARTISTA - Enviando update:', {
        artistId: artist.id,
        name: name.trim(),
        profileUrl: finalProfileUrl,
        originalProfileUrl: originalProfileUrl
      });

      const updateResult = await updateArtist(artist.id, {
        name: name.trim(),
        musical_style: musicalStyle.trim() || undefined,
        whatsapp: isAvailableForGigs ? whatsapp.trim() || null : null,
        email: emailTrim || null,
        show_email: showEmailOnProfile && Boolean(emailTrim),
        city: city.trim() || null,
        state: state.trim() || null,
        is_available_for_gigs: isAvailableForGigs,
        show_whatsapp: isAvailableForGigs && showWhatsappInSearch,
        average_cache_value: isAvailableForGigs ? parsedAverageCacheValue : null,
        work_roles: isAvailableForGigs ? selectedWorkRoles : [],
        show_formats: isAvailableForGigs ? normalizeShowFormats(selectedShowFormats) : [],
        profile_url: finalProfileUrl,
        cover_url: finalCoverUrl.trim() ? finalCoverUrl : null,
        bio: bio.trim() || null,
        social_links: socialLinksToJson({
          youtube: youtubeUrl,
          spotify: spotifyUrl,
          instagram: instagramUrl,
          videos: extraVideos.split('\n'),
        }),
      });

      console.log('📥 EDITAR ARTISTA - Resultado do update:', updateResult);

      if (updateResult.success) {
        console.log('✅ EDITAR ARTISTA - Update bem-sucedido, atualizando estados...');

        // Usar os dados do formulário (update funcionou, mas select pode estar bloqueado por RLS)
        const updatedData = {
          id: artist.id,
          name: name.trim(),
          role: userPermissions?.role || 'admin',
          profile_url: finalProfileUrl || undefined,
          musical_style: musicalStyle.trim() || undefined
        };

        console.log('💾 EDITAR ARTISTA - Atualizando Context:', updatedData);

        // 1. Atualizar Context (salva no AsyncStorage e propaga para todas as telas)
        await setActiveArtistContext(updatedData);

        // 2. Notificar que a imagem foi atualizada
        if (finalProfileUrl !== originalProfileUrl) {
          console.log('🖼️ EDITAR ARTISTA - Notificando mudança de imagem');
          artistImageUpdateService.notifyArtistImageUpdated(artist.id, finalProfileUrl);
        }
        
        console.log('🎉 EDITAR ARTISTA - Processo completo!');
        
        // Mostrar modal de sucesso
        setShowSuccessModal(true);
      } else {
        Alert.alert('Erro', updateResult.error || 'Erro ao atualizar dados do artista');
      }
    } catch {
      Alert.alert('Erro', 'Erro ao salvar alterações');
    } finally {
      setIsSaving(false);
      setIsUploadingImage(false);
    }
  };

  const youtubePreviews = useMemo(
    () =>
      collectSocialPreviewItems({
        youtube: youtubeUrl,
        videos: extraVideos
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      }).filter((item) => item.kind === 'youtube'),
    [extraVideos, youtubeUrl]
  );

  const instagramPreview = useMemo(
    () => collectSocialPreviewItems({ instagram: instagramUrl }).find((item) => item.kind === 'instagram'),
    [instagramUrl]
  );

  const spotifyPreview = useMemo(
    () => collectSocialPreviewItems({ spotify: spotifyUrl }).find((item) => item.kind === 'spotify'),
    [spotifyUrl]
  );

  const renderInput = (
    label: string,
    value: string,
    onChangeText: (text: string) => void,
    placeholder: string,
    keyboardType: TextInputProps['keyboardType'] = 'default',
    required: boolean = false,
    maxLength?: number
  ) => (
    <View style={styles.inputContainer}>
      <Text style={[styles.inputLabel, { color: colors.text }]}>
        {label} {required && <Text style={styles.required}>*</Text>}
      </Text>
      <TextInput
        style={[styles.input, { 
          borderColor: colors.border, 
          backgroundColor: colors.surface,
          color: colors.text 
        }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        keyboardType={keyboardType}
        autoCapitalize="none"
        maxLength={maxLength}
      />
    </View>
  );

  const renderContactWithPublicFlag = ({
    label,
    value,
    onChangeText,
    placeholder,
    keyboardType,
    required,
    publicValue,
    onPublicChange,
  }: {
    label: string;
    value: string;
    onChangeText: (text: string) => void;
    placeholder: string;
    keyboardType: TextInputProps['keyboardType'];
    required?: boolean;
    publicValue: boolean;
    onPublicChange: (value: boolean) => void;
  }) => (
    <View style={styles.inputContainer}>
      <View style={styles.contactPublicHeader}>
        <Text style={[styles.inputLabel, styles.contactPublicTitle, { color: colors.text }]}>
          {label} {required ? <Text style={styles.required}>*</Text> : null}
        </Text>
        <View style={styles.publicFlag}>
          <Text style={[styles.publicFlagLabel, { color: colors.textSecondary }]}>Público</Text>
          <View style={styles.publicSwitchScale}>
            <Switch
              value={publicValue}
              onValueChange={onPublicChange}
              trackColor={{ false: colors.border, true: colors.primary + '80' }}
              thumbColor={Platform.OS === 'android' ? (publicValue ? colors.primary : '#f4f3f4') : undefined}
              ios_backgroundColor={colors.border}
            />
          </View>
        </View>
      </View>
      <TextInput
        style={[
          styles.input,
          {
            borderColor: colors.border,
            backgroundColor: colors.surface,
            color: colors.text,
          },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        keyboardType={keyboardType}
        autoCapitalize="none"
      />
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Editar Artista</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Carregando dados do artista...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Editar Artista</Text>
        <TouchableOpacity
          onPress={() =>
            router.push({ pathname: '/perfil-artista', params: { artistId: artist?.id || activeArtist?.id || '' } })
          }
          style={styles.previewBtn}
          hitSlop={8}
        >
          <Ionicons name="eye-outline" size={20} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={handleSave} 
          style={[styles.saveButton, { backgroundColor: colors.primary }]}
          disabled={isSaving || isUploadingImage}
        >
          {isSaving || isUploadingImage ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Salvar</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {/* Informações do artista */}
        {artist && (
          <View style={[styles.artistInfoCard, { backgroundColor: colors.surface }]}>
            <TouchableOpacity onPress={handleSelectCover} activeOpacity={0.8} style={styles.coverTap}>
              {coverUrl && coverUrl.trim() !== '' && !coverLoadError ? (
                <Image
                  source={{ uri: coverUrl }}
                  style={styles.coverImage}
                  resizeMode="cover"
                  onError={() => setCoverLoadError(true)}
                />
              ) : (
                <View style={[styles.coverPlaceholder, { backgroundColor: colors.background }]}>
                  <Ionicons name="image-outline" size={22} color={colors.primary} />
                  <Text style={[styles.coverHint, { color: colors.textSecondary }]}>
                    Toque para adicionar uma capa
                  </Text>
                </View>
              )}
              <View style={[styles.coverCamera, { backgroundColor: colors.primary }]}>
                <Ionicons name="camera" size={14} color="#fff" />
              </View>
            </TouchableOpacity>
            {coverUrl ? (
              <TouchableOpacity onPress={() => { setCoverUrl(''); setCoverLoadError(false); }} style={styles.removeCover}>
                <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>Remover capa</Text>
              </TouchableOpacity>
            ) : null}
            <View style={styles.artistRow}>
            <TouchableOpacity 
              style={styles.avatarContainer}
              onPress={handleSelectImage}
              activeOpacity={0.7}
            >
              {profileUrl && profileUrl.trim() !== '' && !imageLoadError ? (
                <Image
                  source={{
                    uri: `${profileUrl}${profileUrl.includes('?') ? '&' : '?'}t=${Date.now()}`,
                    cache: 'reload'
                  }}
                  style={[styles.artistAvatarImage, { borderColor: colors.primary }]}
                  resizeMode="cover"
                  onError={() => {
                    setImageLoadError(true);
                  }}
                  onLoad={() => {
                    setImageLoadError(false);
                  }}
                />
              ) : (
                <View style={[styles.artistAvatarPlaceholder, { backgroundColor: colors.background, borderColor: colors.primary }]}>
                  <Ionicons name="musical-notes" size={40} color={colors.primary} />
                </View>
              )}
              <View style={[styles.editImageOverlay, { backgroundColor: colors.primary }]}>
                <Ionicons name="camera" size={20} color="#fff" />
              </View>
            </TouchableOpacity>
            <View style={styles.artistInfo}>
              <Text style={[styles.artistName, { color: colors.text }]}>{artist.name}</Text>
              <Text style={[styles.artistRole, { color: colors.primary }]}>
                {userPermissions?.role === 'admin'
                  ? 'Administrador'
                  : userPermissions?.role === 'vendedor'
                    ? 'Vendedor'
                    : userPermissions?.role === 'viewer'
                      ? 'Visualizador'
                      : 'Colaborador'}
              </Text>
              <Text style={[styles.editImageText, { color: colors.textSecondary }]}>Toque na imagem para alterar</Text>
            </View>
            </View>
          </View>
        )}

        {/* Formulário */}
        <View style={[styles.formContainer, { backgroundColor: colors.surface }]}>
          {renderInput(
            'Nome do Artista',
            name,
            setName,
            'Digite o nome do artista',
            'default',
            true,
            50
          )}

          {/* Estilo Musical */}
          <View style={styles.inputContainer}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>
              Estilo Musical
            </Text>
            <TouchableOpacity
              style={[styles.input, { 
                borderColor: colors.border, 
                backgroundColor: colors.surface,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }]}
              onPress={() => setShowEstilos(true)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <Ionicons name="musical-note-outline" size={20} color={colors.textSecondary} style={{ marginRight: 8 }} />
                <Text style={[
                  { color: musicalStyle ? colors.text : colors.textSecondary, fontSize: 16 }
                ]}>
                  {musicalStyle || 'Selecione o estilo musical'}
                </Text>
              </View>
              <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.inputContainer}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>Bio</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8, lineHeight: 18 }}>
              Um pouco sobre a carreira: história, palco e o que te define.
            </Text>
            <TextInput
              style={[
                styles.input,
                styles.bioInput,
                { borderColor: colors.border, backgroundColor: colors.surface, color: colors.text },
              ]}
              value={bio}
              onChangeText={setBio}
              placeholder="Ex.: Músico e compositor com 20 anos de estrada, voz e violão, shows autorais e repertório de MPB."
              placeholderTextColor={colors.textSecondary}
              multiline
              maxLength={600}
            />
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 6, textAlign: 'right' }}>
              {bio.length}/600
            </Text>
          </View>

          {renderInput('YouTube', youtubeUrl, setYoutubeUrl, 'https://youtube.com/...', 'url', false)}
          {youtubePreviews[0] ? (
            <View style={styles.youtubePreview}>
              <SocialMediaPreviewCard item={youtubePreviews[0]} featured subtitle={bio} />
            </View>
          ) : null}
          {renderInput('Spotify', spotifyUrl, setSpotifyUrl, 'https://open.spotify.com/...', 'url', false)}
          {spotifyPreview ? (
            <View style={styles.youtubePreview}>
              <SocialMediaPreviewCard item={spotifyPreview} featured />
            </View>
          ) : null}
          {renderInput('Instagram', instagramUrl, setInstagramUrl, 'https://instagram.com/...', 'url', false)}
          {instagramPreview ? (
            <View style={styles.youtubePreview}>
              <SocialMediaPreviewCard item={instagramPreview} featured />
            </View>
          ) : null}

          <View style={styles.inputContainer}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>Outros vídeos ou músicas</Text>
            <TextInput
              style={[
                styles.input,
                styles.bioInput,
                { borderColor: colors.border, backgroundColor: colors.surface, color: colors.text },
              ]}
              value={extraVideos}
              onChangeText={setExtraVideos}
              placeholder="Um link por linha (YouTube ou Spotify)"
              placeholderTextColor={colors.textSecondary}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
            />
            {youtubePreviews.slice(1).map((item) => (
              <View key={item.url} style={styles.youtubePreview}>
                <SocialMediaPreviewCard item={item} featured />
              </View>
            ))}
          </View>

          <View style={styles.inputContainer}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>
              Cidade <Text style={styles.required}>*</Text>
            </Text>
            <BrazilPlaceSearchField
              value={city}
              onChangeText={setCity}
              onSelectPlace={(place) => {
                setCity(place.city);
                setState(place.stateName);
              }}
              placeholder="Buscar cidade, rua ou CEP"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>
              Estado <Text style={styles.required}>*</Text>
            </Text>
            <TouchableOpacity
              style={[
                styles.estadoSelector,
                { borderColor: colors.border, backgroundColor: colors.surface },
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
              <View style={[styles.estadosList, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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

          <View style={styles.inputContainer}>
            <Text style={[styles.inputLabel, { color: colors.text }]}>
              Disponível para trabalhos
            </Text>
            <View
              style={[
                styles.switchRow,
                { borderColor: colors.border, backgroundColor: colors.surface },
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
                ? 'Ligado: este artista aparece na busca para receber convites. WhatsApp, cidade e estado são obrigatórios.'
                : 'Desligado: este artista não aparece na busca de convites até você ligar novamente.'}
            </Text>
          </View>

          {renderContactWithPublicFlag({
            label: 'E-mail',
            value: email,
            onChangeText: setEmail,
            placeholder: 'contato@email.com',
            keyboardType: 'email-address',
            publicValue: showEmailOnProfile,
            onPublicChange: setShowEmailOnProfile,
          })}

          {isAvailableForGigs && (
            <>
              {renderContactWithPublicFlag({
                label: 'WhatsApp',
                value: whatsapp,
                onChangeText: setWhatsapp,
                placeholder: '(00) 00000-0000',
                keyboardType: 'phone-pad',
                required: true,
                publicValue: showWhatsappInSearch,
                onPublicChange: setShowWhatsappInSearch,
              })}

              <View style={styles.inputContainer}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>Cachê médio (R$)</Text>
                <View
                  style={[
                    styles.input,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                      flexDirection: 'row',
                      alignItems: 'center',
                    },
                  ]}
                >
                  <Ionicons name="cash-outline" size={20} color={colors.textSecondary} style={{ marginRight: 8 }} />
                  <Text style={[styles.currencyPrefix, { color: colors.textSecondary }]}>R$</Text>
                  <TextInput
                    style={{ flex: 1, color: colors.text, fontSize: 16 }}
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
        </View>

        <TouchableOpacity
          style={[styles.pressKitRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={handlePressKitPress}
          activeOpacity={0.75}
        >
          <View style={[styles.pressKitIconWrap, { backgroundColor: colors.primary + '22' }]}>
            <Ionicons name="images-outline" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.pressKitTitle, { color: colors.text }]}>Press kit e identidade</Text>
            <Text style={[styles.pressKitSub, { color: colors.textSecondary }]}>
              {userPermissions?.role === 'admin'
                ? 'Adicione imagens, áudios para compartilhar rápido com sua equipe e contratantes.'
                : 'Somente o administrador pode abrir e gerenciar o press kit.'}
            </Text>
          </View>
          {userPermissions?.role === 'admin' ? (
            <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
          ) : (
            <Ionicons name="lock-closed" size={22} color={colors.textSecondary} />
          )}
        </TouchableOpacity>

        {/* Informações adicionais */}
        <View style={[styles.infoCard, { backgroundColor: colors.primary + '20' }]}>
          <Ionicons name="information-circle" size={20} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.primary }]}>
            Campos marcados com * são obrigatórios. As alterações serão salvas automaticamente.
          </Text>
        </View>
      </ScrollView>

      {/* Modal de permissão */}
      <PermissionModal
        visible={showPermissionModal}
        onClose={() => setShowPermissionModal(false)}
        title="Acesso Restrito"
        message="Você não possui permissão para editar as informações deste artista. Entre em contato com um administrador para solicitar acesso."
        icon="lock-closed"
      />

      {/* Modal de Seleção de Estilo Musical */}
      <Modal
        visible={showEstilos}
        transparent
        animationType="slide"
        onRequestClose={() => setShowEstilos(false)}
      >
        <TouchableOpacity 
          style={styles.estilosModalOverlay}
          activeOpacity={1}
          onPress={() => setShowEstilos(false)}
        >
          <View 
            style={[styles.estilosModalContent, { backgroundColor: colors.surface }]} 
            onStartShouldSetResponder={() => true}
          >
            <View style={[styles.estilosModalHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.estilosModalTitle, { color: colors.text }]}>Selecione o Estilo Musical</Text>
              <TouchableOpacity onPress={() => setShowEstilos(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.estilosModalList}>
              {estilosMusicais.map((estilo) => (
                <TouchableOpacity
                  key={estilo}
                  style={[
                    styles.estilosModalItem,
                    { borderBottomColor: colors.border },
                    musicalStyle === estilo && { backgroundColor: colors.primary + '20' }
                  ]}
                  onPress={() => {
                    setMusicalStyle(estilo);
                    setShowEstilos(false);
                  }}
                >
                  <Text style={[
                    styles.estilosModalItemText, 
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

      {/* Modal de sucesso */}
      <Modal
        visible={showSuccessModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowSuccessModal(false);
          router.back();
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>
            <View style={styles.modalIconContainer}>
              <View style={[styles.modalIcon, { backgroundColor: '#10B981' + '20' }]}>
                <Ionicons name="checkmark-circle" size={48} color="#10B981" />
              </View>
            </View>
            
            <Text style={[styles.modalTitle, { color: colors.text }]}>Sucesso!</Text>
            
            <Text style={[styles.modalMessage, { color: colors.textSecondary }]}>
              Dados do artista atualizados com sucesso!
            </Text>
            
            <TouchableOpacity 
              style={[styles.modalButton, { backgroundColor: colors.primary }]}
              onPress={() => {
                setShowSuccessModal(false);
                router.back();
              }}
            >
              <Text style={styles.modalButtonText}>OK</Text>
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
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  previewBtn: {
    padding: 8,
    marginRight: 4,
  },
  saveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  coverTap: {
    marginHorizontal: -16,
    marginTop: -16,
    marginBottom: 12,
    height: 120,
    overflow: 'hidden',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  coverImage: { width: '100%', height: '100%' },
  coverPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  coverHint: { fontSize: 13 },
  coverCamera: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeCover: { alignSelf: 'flex-end', marginBottom: 8 },
  bioInput: {
    minHeight: 90,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  placeholder: {
    width: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  content: {
    flex: 1,
  },
  artistInfoCard: {
    margin: 20,
    borderRadius: 12,
    padding: 20,
    overflow: 'hidden',
    flexDirection: 'column',
    alignItems: 'stretch',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.1,
    shadowRadius: Platform.OS === 'android' ? 0 : 3.84,
    elevation: Platform.OS === 'android' ? 0 : 5,
  },
  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 15,
  },
  artistAvatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
  },
  artistAvatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
  },
  editImageOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  editImageText: {
    fontSize: 12,
    marginTop: 4,
    fontStyle: 'italic',
  },
  artistInfo: {
    flex: 1,
  },
  artistName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  artistRole: {
    fontSize: 14,
    fontWeight: '600',
  },
  formContainer: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.1,
    shadowRadius: Platform.OS === 'android' ? 0 : 3.84,
    elevation: Platform.OS === 'android' ? 0 : 5,
  },
  inputContainer: {
    marginBottom: 20,
  },
  youtubePreview: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  required: {
    color: '#F44336',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
  },
  contactPublicHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  contactPublicTitle: {
    marginBottom: 0,
    flex: 1,
  },
  publicFlag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  publicFlagLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  publicSwitchScale: {
    transform: [{ scale: 0.72 }],
  },
  currencyPrefix: {
    fontSize: 16,
    fontWeight: '600',
    marginRight: 8,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 52,
  },
  estadoSelector: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  estadoText: {
    fontSize: 16,
    flex: 1,
  },
  estadosList: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 8,
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
  pressKitRow: {
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pressKitIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressKitTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  pressKitSub: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  infoCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 8,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 14,
    lineHeight: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    borderRadius: 16,
    padding: 24,
    margin: 20,
    maxWidth: 320,
    width: '90%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: Platform.OS === 'android' ? 0 : 0.25,
    shadowRadius: Platform.OS === 'android' ? 0 : 3.84,
    elevation: Platform.OS === 'android' ? 0 : 5,
  },
  modalIconContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  modalIcon: {
    borderRadius: 50,
    padding: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 12,
  },
  modalMessage: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  modalButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  estilosModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  estilosModalContent: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    paddingBottom: 20,
  },
  estilosModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
  },
  estilosModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  estilosModalList: {
    maxHeight: 400,
  },
  estilosModalItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  estilosModalItemText: {
    fontSize: 16,
    flex: 1,
    paddingRight: 12,
  },
});
