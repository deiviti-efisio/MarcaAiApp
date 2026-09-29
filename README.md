# Marca AI

App mobile para **artistas e equipes** organizarem agenda, eventos, finanças, colaboradores e divulgação. Feito com **React Native**, **Expo** e **Supabase**.

| Loja | Identificador |
|------|----------------|
| iOS | `com.marcaai.app` |
| Android | `com.marcaaipro.app` |
| Versão do app (`app.json`) | **2.0.4** (iOS build **106**, Android versionCode **52**) |
| Deep link | esquema `marcaai://` |

---

## O que o app faz

- **Conta**: cadastro e login (e-mail, Google, Apple no iOS), perfil, foto, exclusão de conta.
- **Artistas**: um ou mais perfis de artista, membros com papéis (admin, colaborador, vendedor, visualização, etc.).
- **Agenda**: calendário de eventos, criação/edição, valor, data/hora, local (UF), contrato em PDF, convites de participação entre artistas.
- **Financeiro**: receitas de shows, despesas do evento ou avulsas, metas, exportação PDF (sujeito a plano / trial).
- **Time**: convites de colaborador, parceiros frequentes, press kit.
- **Feed**: vitrine de artistas e oportunidades (marketplace), curtidas, reputação.
- **Premium**: assinatura via lojas (In-App Purchase), limites do plano gratuito documentados em [`documentacao/LIMITES_PLANO_FREE_PREMIUM.md`](documentacao/LIMITES_PLANO_FREE_PREMIUM.md).
- **Push**: notificações de agenda, convites e alterações (Firebase + Edge Functions).

Fluxos detalhados (diagramas e queries): pasta [`documentacao/`](documentacao/README.md).

---

## Stack

| Camada | Tecnologia |
|--------|------------|
| App | Expo SDK **54**, React Native **0.81**, React **19**, Expo Router |
| Linguagem | TypeScript |
| Backend | Supabase (Auth, Postgres, Storage, RLS, Edge Functions) |
| Estado local | AsyncStorage, contextos React |
| Auth social | Google Sign-In, Sign in with Apple |
| Push | Firebase Cloud Messaging + `@react-native-firebase/messaging` |
| Assinatura | `expo-iap` (App Store / Google Play) |
| Build loja | EAS Build (`eas.json`) |

**Expo Go não cobre este projeto.** Login Google, Firebase, IAP e módulos nativos exigem **development build** ou `expo run:ios` / `expo run:android`.

---

## O que você precisa no computador

### Obrigatório para qualquer plataforma

- **Node.js 20+** (recomendado LTS)
- **npm** (vem com o Node)
- Git
- Conta e projeto no [Supabase](https://supabase.com) (o app aponta para o projeto em `lib/supabase.ts`)

### iOS (macOS)

- Xcode recente, com **Command Line Tools**
- CocoaPods (`sudo gem install cocoapods` ou via Homebrew)
- Simulador iOS ou iPhone físico
- Apple ID de desenvolvedor (build de loja / TestFlight / Sign in with Apple)

```bash
npx expo run:ios
```

### Android

- [Android Studio](https://developer.android.com/studio) (SDK, emulador)
- JDK 17
- `google-services.json` em `android/app/` (Firebase) — já esperado pelo `app.json`

```bash
npx expo run:android
```

### Contas e consoles (funcionalidades completas)

| Serviço | Para quê |
|---------|----------|
| Supabase | Auth, banco, Storage, RLS, Edge Functions |
| Google Cloud / Firebase | Login Google, FCM, `google-services.json` |
| Apple Developer | Sign in with Apple, push iOS, IAP, App Store |
| Google Play Console | Billing / IAP Android, AAB |
| Expo (EAS) | Builds na nuvem (`eas-cli`) |

Guias específicos na pasta [`docs/`](docs/): Firebase Android, Google OAuth, notificações iOS, IAP, Storage, deep links.

---

## Como rodar o app

```bash
git clone https://github.com/deiviti-efisio/MarcaAiApp.git
cd MarcaAiApp   # ou APP_MOBILE_MARCA_AI, conforme a pasta local

npm install
npx expo start
```

No terminal do Metro, use **i** (iOS) ou **a** (Android) **depois** de ter um binário nativo instalado.

Scripts do `package.json`:

| Comando | Uso |
|---------|-----|
| `npm start` | Metro / Expo Dev Server |
| `npm run ios` | Compila e abre no iOS |
| `npm run android` | Compila e abre no Android |
| `npm run lint` | ESLint (config Expo) |
| `npm run web` | Web (saída estática; o produto principal é o app nativo) |

Não use `npm run reset-project` neste repositório: ele apaga a estrutura `app/` do produto.

---

## Backend (Supabase)

### Cliente no app

URL e **chave anon** ficam em `lib/supabase.ts` (e trechos equivalentes em serviços que chamam Edge Functions). Em um fork ou ambiente novo:

1. Crie o projeto no dashboard.
2. Em **Settings → API**, copie **Project URL** e **anon public**.
3. Atualize `lib/supabase.ts`.
4. Nunca coloque a **service role** no app. Ela só vai nas Edge Functions (secrets do Supabase).

### Banco e políticas

O schema evolui por scripts SQL em [`database/`](database/). Não há um único dump “do zero” versionado: o projeto em produção já tem as tabelas. Para um ambiente novo, aplique os scripts no **SQL Editor** na ordem do histórico do time (Auth + `users`, artistas, eventos, feed, assinaturas, trial financeiro, etc.).

Instruções pontuais: [`database/INSTRUCOES_MIGRATION.md`](database/INSTRUCOES_MIGRATION.md). RLS e papéis: [`docs/PERMISSIONS_GUIDE.md`](docs/PERMISSIONS_GUIDE.md), [`docs/GUIA_COMPLETO_ROLES.md`](docs/GUIA_COMPLETO_ROLES.md).

Storage (fotos, press kit, contratos): [`docs/SUPABASE_STORAGE_SETUP.md`](docs/SUPABASE_STORAGE_SETUP.md).

Auth (e-mail, redirects, deep links): [`docs/SUPABASE_EMAIL_CONFIG.md`](docs/SUPABASE_EMAIL_CONFIG.md), [`docs/SUPABASE_DEEP_LINKS_CONFIG.md`](docs/SUPABASE_DEEP_LINKS_CONFIG.md), [`docs/CONFIGURAR_GOOGLE_OAUTH_SUPABASE.md`](docs/CONFIGURAR_GOOGLE_OAUTH_SUPABASE.md).

### Edge Functions (`supabase/functions/`)

Implante com a CLI do Supabase. Secrets típicos:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Funções atuais:

| Função | Função de negócio |
|--------|-------------------|
| `send-push` / `send-push-notification` / `send-push-single` / `send-basic-notification` | Push |
| `activate-subscription` | Webhook / ativação de assinatura (Apple) |
| `delete_user_account` / `delete_user_app` | Exclusão de conta (admin Auth) |

Push no app: [`docs/GUIA_CONFIGURAR_NOTIFICACOES_IOS.md`](docs/GUIA_CONFIGURAR_NOTIFICACOES_IOS.md), [`docs/CONFIGURAR_FIREBASE_ANDROID.md`](docs/CONFIGURAR_FIREBASE_ANDROID.md), [`docs/COMO_ENVIAR_NOTIFICACAO_AGENDA.md`](docs/COMO_ENVIAR_NOTIFICACAO_AGENDA.md).

---

## Planos Free e Premium

Regras **implementadas** (código + SQL), não só o texto de marketing:

- Free: em geral **1** perfil de artista como admin e **até 3** pessoas no time por artista.
- Premium: mais artistas como admin, time sem o teto de 3 (quando um admin do artista tem assinatura ativa), financeiro sem o trial de 3 exportações / 3 aberturas de detalhe.

Detalhe: [`documentacao/LIMITES_PLANO_FREE_PREMIUM.md`](documentacao/LIMITES_PLANO_FREE_PREMIUM.md).  
IAP e tela de planos: [`docs/GUIA_ASSINATURAS_IAP.md`](docs/GUIA_ASSINATURAS_IAP.md), [`docs/PLANOS_PAGAMENTOS_README.md`](docs/PLANOS_PAGAMENTOS_README.md).  
SQL: `database/USER_SUBSCRIPTIONS.sql`, `database/free_financial_trial.sql`.

Produtos nas lojas precisam existir e coincidir com os IDs usados no app (`expo-iap`). Sem isso, a lista de produtos vem vazia ([`docs/SOLUCAO_IAP_IOS_PRODUTOS_VAZIOS.md`](docs/SOLUCAO_IAP_IOS_PRODUTOS_VAZIOS.md)).

---

## Estrutura do repositório

```
app/                 Telas (Expo Router)
components/          UI reutilizável
contexts/            Tema, mês da agenda, sessão, etc.
services/            Chamadas Supabase e regras de negócio
lib/                 Cliente Supabase e utilitários
hooks/
database/            Scripts SQL
supabase/functions/  Edge Functions (Deno)
docs/                Guias de setup e troubleshooting
documentacao/        Fluxos de produto (Mermaid)
android/  ios/       Projetos nativos (prebuild / run)
assets/
```

---

## Builds para loja (EAS)

```bash
npm install -g eas-cli
eas login
eas build --platform ios --profile production
eas build --platform android --profile production
```

Perfis em `eas.json`: `preview` (APK), `production` (AAB no Android), entre outros.

Versão: altere `expo.version`, `ios.buildNumber` e `android.versionCode` em `app.json` (e o `versionCode` espelhado em `android/app/build.gradle` quando o nativo estiver gerado).

Mais comandos: [`docs/comandos.md`](docs/comandos.md) (ignore senhas que possam aparecer em docs antigos; use só as suas contas).

---

## Permissões no dispositivo

O app pede, conforme o fluxo:

- Câmera e galeria (foto de perfil / press kit)
- Documentos / compartilhamento (PDF)
- Notificações

Textos de permissão estão em `app.json` (`infoPlist` e plugin `expo-image-picker`).

---

## Problemas comuns

| Sintoma | Onde olhar |
|---------|------------|
| Metro / bundler | [`docs/SOLUCAO_METRO_BUNDLER.md`](docs/SOLUCAO_METRO_BUNDLER.md) |
| Crash TestFlight / dSYM Hermes | `docs/SOLUCAO_DSYM_HERMES.md`, `docs/SOLUCAO_CRASH_TESTFLIGHT.md` |
| Login Google Android | [`docs/GOOGLE_LOGIN_ANDROID.md`](docs/GOOGLE_LOGIN_ANDROID.md) |
| Push | guias de notificação em `docs/` |
| Reset de senha | [`docs/TROUBLESHOOTING_RESET_PASSWORD.md`](docs/TROUBLESHOOTING_RESET_PASSWORD.md) |

---

## Segurança

- A chave **anon** é pública por desenho (RLS protege os dados). Ainda assim, não publique a **service role**.
- Não commite tokens GitHub, senhas de EAS ou `google-services.json` de produção em repositórios públicos se a política do time exigir sigilo.
- Após um push com Personal Access Token, revogue o token no GitHub.

---

## Contato

- E-mail: **marcaaiapp@gmail.com**

---

## Licença

Repositório **privado** (`"private": true` no `package.json`). Uso conforme o dono do projeto.
