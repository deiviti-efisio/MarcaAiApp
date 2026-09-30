import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

const WORDMARK = require('../assets/images/logo_meushow_escrita_pdf.png');

let cachedDataUri: string | null = null;

/** PNG do logo (ingresso + MeuShow) em data URI para HTML de PDF. */
export async function getMeuShowWordmarkDataUri(): Promise<string> {
  if (cachedDataUri) return cachedDataUri;
  const asset = Asset.fromModule(WORDMARK);
  await asset.downloadAsync();
  const fileUri = asset.localUri ?? asset.uri;
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  cachedDataUri = `data:image/png;base64,${base64}`;
  return cachedDataUri;
}

export function meuShowPdfLogoHtml(dataUri: string): string {
  return `<img class="brand-wordmark" src="${dataUri}" alt="MeuShow" />`;
}
