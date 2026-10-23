import { BRAZIL_STATES, brazilStateByName, type BrazilState } from '../lib/brazilGeo';

export type BrazilPlaceKind = 'city' | 'street' | 'cep' | 'venue';

export type BrazilPlace = {
  id: string;
  kind: BrazilPlaceKind;
  label: string;
  city: string;
  uf: string;
  stateName: string;
  street?: string;
  neighborhood?: string;
  cep?: string;
};

type IbgeMunicipio = {
  id: number;
  nome: string;
  microrregiao?: {
    mesorregiao?: {
      UF?: { sigla?: string; nome?: string };
    };
  };
};

const municipiosByUf = new Map<string, BrazilPlace[]>();
const municipiosByUfPromise = new Map<string, Promise<BrazilPlace[]>>();
let municipiosBrasil: BrazilPlace[] | null = null;
let municipiosBrasilPromise: Promise<BrazilPlace[]> | null = null;

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function stateFromUfOrName(uf?: string | null, name?: string | null): BrazilState | undefined {
  if (uf && uf.trim().length === 2) {
    const found = BRAZIL_STATES.find((s) => s.uf === uf.trim().toUpperCase());
    if (found) return found;
  }
  return brazilStateByName(name);
}

async function loadMunicipiosByUf(uf: string): Promise<BrazilPlace[]> {
  const key = uf.trim().toUpperCase();
  if (key.length !== 2) return [];
  const cached = municipiosByUf.get(key);
  if (cached) return cached;
  const pending = municipiosByUfPromise.get(key);
  if (pending) return pending;

  const request = (async () => {
    const res = await fetch(
      `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${key}/municipios?orderBy=nome`
    );
    if (!res.ok) throw new Error('IBGE indisponível');
    const rows = (await res.json()) as IbgeMunicipio[];
    const state = stateFromUfOrName(key, null);
    if (!state) return [];
    const places: BrazilPlace[] = rows
      .map((row) => ({
        id: `ibge-${row.id}`,
        kind: 'city' as const,
        label: `${row.nome} — ${state.uf}`,
        city: row.nome,
        uf: state.uf,
        stateName: state.name,
      }))
      .filter((place) => Boolean(place.city));
    municipiosByUf.set(key, places);
    return places;
  })();

  municipiosByUfPromise.set(key, request);
  try {
    return await request;
  } catch (err) {
    municipiosByUfPromise.delete(key);
    throw err;
  }
}

function rankCityMatch(query: string, place: BrazilPlace): number {
  const q = fold(query);
  const city = fold(place.city);
  if (city === q) return 0;
  if (city.startsWith(q)) return 1;
  if (city.includes(q)) return 2;
  return 9;
}

function mapIbgeMunicipio(row: IbgeMunicipio): BrazilPlace | null {
  const ufSigla = row.microrregiao?.mesorregiao?.UF?.sigla;
  const ufNome = row.microrregiao?.mesorregiao?.UF?.nome;
  const state = stateFromUfOrName(ufSigla, ufNome);
  const city = (row.nome || '').trim();
  if (!state || !city) return null;
  return {
    id: `ibge-${row.id}`,
    kind: 'city',
    label: `${city} — ${state.uf}`,
    city,
    uf: state.uf,
    stateName: state.name,
  };
}

async function loadMunicipiosBrasil(): Promise<BrazilPlace[]> {
  if (municipiosBrasil) return municipiosBrasil;
  if (municipiosBrasilPromise) return municipiosBrasilPromise;
  const request = (async () => {
    const res = await fetch(
      'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome'
    );
    if (!res.ok) throw new Error('IBGE indisponível');
    const rows = (await res.json()) as IbgeMunicipio[];
    const places = rows.map(mapIbgeMunicipio).filter((place): place is BrazilPlace => Boolean(place));
    municipiosBrasil = places;
    return places;
  })();
  municipiosBrasilPromise = request;
  try {
    return await request;
  } catch (err) {
    municipiosBrasilPromise = null;
    throw err;
  }
}

async function searchMunicipios(query: string, limit: number, uf?: string): Promise<BrazilPlace[]> {
  const q = fold(query);
  if (q.length < 2) return [];
  const ufKey = (uf || '').trim().toUpperCase();
  try {
    const all = ufKey.length === 2 ? await loadMunicipiosByUf(ufKey) : await loadMunicipiosBrasil();
    return all
      .filter((place) => fold(place.city).includes(q))
      .sort((a, b) => rankCityMatch(query, a) - rankCityMatch(query, b))
      .slice(0, limit);
  } catch {
    return [];
  }
}

async function searchViaCep(digits: string): Promise<BrazilPlace[]> {
  if (digits.length !== 8) return [];
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      erro?: boolean;
      localidade?: string;
      uf?: string;
      logradouro?: string;
      bairro?: string;
      cep?: string;
    };
    if (data.erro || !data.localidade || !data.uf) return [];
    const state = stateFromUfOrName(data.uf, null);
    if (!state) return [];
    const street = (data.logradouro || '').trim();
    const neighborhood = (data.bairro || '').trim();
    const cep = (data.cep || digits).trim();
    const parts = [street, neighborhood, `${data.localidade} — ${state.uf}`].filter(Boolean);
    return [
      {
        id: `cep-${digits}`,
        kind: 'cep',
        label: parts.join(', '),
        city: data.localidade,
        uf: state.uf,
        stateName: state.name,
        street: street || undefined,
        neighborhood: neighborhood || undefined,
        cep,
      },
    ];
  } catch {
    return [];
  }
}

type PhotonFeature = {
  properties?: {
    osm_id?: number;
    osm_value?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    district?: string;
    county?: string;
    state?: string;
    postcode?: string;
    countrycode?: string;
  };
};

async function searchPhoton(query: string, limit: number): Promise<BrazilPlace[]> {
  if (query.trim().length < 3) return [];
  try {
    const url =
      `https://photon.komoot.io/api/?q=${encodeURIComponent(query.trim())}` +
      `&lang=pt&limit=${limit}&lat=-14.2&lon=-51.9`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as { features?: PhotonFeature[] };
    const out: BrazilPlace[] = [];
    for (const feature of json.features || []) {
      const p = feature.properties || {};
      if ((p.countrycode || '').toUpperCase() && (p.countrycode || '').toUpperCase() !== 'BR') {
        continue;
      }
      const state = stateFromUfOrName(null, p.state);
      const city = (p.city || p.county || p.name || '').trim();
      if (!state || !city) continue;
      const streetBase = (p.street || (p.osm_value === 'house' || p.osm_value === 'residential' ? p.name : '') || '').trim();
      const street = [streetBase, p.housenumber].filter(Boolean).join(', ');
      const neighborhood = (p.district || '').trim();
      const kind: BrazilPlaceKind = street ? 'street' : p.osm_value === 'city' ? 'city' : 'venue';
      const labelParts = [
        street || p.name || city,
        neighborhood,
        `${city} — ${state.uf}`,
      ].filter((part, idx, arr) => part && arr.indexOf(part) === idx);
      out.push({
        id: `photon-${p.osm_id || `${city}-${street}`}`,
        kind,
        label: labelParts.join(', '),
        city,
        uf: state.uf,
        stateName: state.name,
        street: street || undefined,
        neighborhood: neighborhood || undefined,
        cep: p.postcode || undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function looksLikeStreetQuery(query: string): boolean {
  const q = fold(query);
  return /^(rua|r\.|avenida|av\.|alameda|travessa|tv\.|estrada|rodovia|praca|praça|cep|\d{5})/.test(q)
    || /\d{5}-?\d{3}/.test(q)
    || q.split(' ').length >= 3;
}

export async function searchBrazilPlaces(
  query: string,
  opts?: { uf?: string; citiesOnly?: boolean }
): Promise<BrazilPlace[]> {
  const raw = query.trim();
  if (raw.length < 2) return [];

  try {
    if (opts?.citiesOnly) {
      const cities = await searchMunicipios(raw, 10, opts?.uf);
      if (cities.length) return cities;
      const photon = await searchPhoton(raw, 8);
      const seen = new Set<string>();
      const out: BrazilPlace[] = [];
      for (const place of photon) {
        if (place.street) continue;
        const key = `${fold(place.city)}|${place.uf}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...place, kind: 'city', label: `${place.city} — ${place.uf}` });
      }
      return out.slice(0, 10);
    }

    const digits = raw.replace(/\D/g, '');
    const [cities, cepPlaces, photon] = await Promise.all([
      searchMunicipios(raw, 8, opts?.uf),
      digits.length === 8 ? searchViaCep(digits) : Promise.resolve([] as BrazilPlace[]),
      looksLikeStreetQuery(raw) ? searchPhoton(raw, 6) : Promise.resolve([] as BrazilPlace[]),
    ]);

    const seen = new Set<string>();
    const merged: BrazilPlace[] = [];
    for (const place of [...cepPlaces, ...cities, ...photon]) {
      const key = `${place.kind}|${fold(place.label)}|${place.uf}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(place);
    }
    return merged.slice(0, 12);
  } catch {
    return [];
  }
}
