// Interface language for the Jobshell website: English, Italian and Spanish, like the app.
// The language comes from the browser languages, in order of preference; English when none matches.
// The page is readable in English without this script: the HTML carries the English text.
(function () {
  var SUPPORTED = ["en", "it", "es"];

  var DICT = {
    en: {
      "home.title": "Jobshell: find the jobs that match your CV",
      "home.description": "Jobshell reads your CV, builds your profile with AI and ranks job postings by how well they match, with the reasons for each match.",
      "home.h1": "Find the jobs that match your CV.",
      "home.lead": "Jobshell reads your CV, builds your profile with AI and ranks job postings by how well they fit you, showing the reasons behind every match.",
      "dl.mac": "Download for macOS",
      "dl.mac.small": "Apple Silicon (M1 and later) · .dmg",
      "dl.win": "Download for Windows",
      "dl.win.small": "Windows 10 and later · x64 installer",
      "dl.linux": "Download for Linux",
      "dl.linux.small": "AppImage · x64",
      "home.note": "The apps are not code-signed yet. macOS blocks the first launch: follow the <a href=\"/install-macos.html\">macOS install guide</a>. Windows SmartScreen may show a warning too. The source code is public on <a href=\"https://github.com/micio86dev/jobshell\">GitHub</a>.",
      "home.whatTitle": "What it does",
      "f1.title": "Upload your CV",
      "f1.text": "PDF, .txt or .md. The file stays on your computer.",
      "f2.title": "An AI-built profile",
      "f2.text": "Jobshell fills in your profile from the CV and flags the fields still missing.",
      "f3.title": "Ranked job postings",
      "f3.text": "Each posting gets a match score and the reasons for it, so you can see why it ranks where it does.",
      "f4.title": "Your keys stay safe",
      "f4.text": "API keys are kept in the operating system keychain and read only by the app.",
      "f5.title": "English, Italian and Spanish",
      "f5.text": "The app interface is available in all three languages and follows your system language.",
      "home.statusTitle": "Status",
      "home.status": "Jobshell is at version 0.1.2. Builds for macOS, Windows and Linux are produced by the release workflow. Only the macOS build has been tested by hand so far. See the <a href=\"https://github.com/micio86dev/jobshell/blob/main/CHANGELOG.md\">changelog</a> for what is in each version.",
      "home.footer": "Jobshell is released under the Apache-2.0 licence. <a href=\"https://github.com/micio86dev/jobshell\">Source on GitHub</a>.",

      "guide.title": "Install Jobshell on macOS",
      "guide.description": "How to open Jobshell on macOS when the app is not signed with an Apple developer certificate.",
      "guide.back": "← Jobshell",
      "guide.h1": "Install Jobshell on macOS",
      "guide.intro": "Jobshell is not signed with an Apple developer certificate yet, so macOS blocks the first launch. The steps below open it once; after that it starts normally. This applies to Apple Silicon Macs (M1 and later), the only architecture the current build produces.",
      "guide.s1": "1. Download and install",
      "guide.s1.1": "Download the <code>.dmg</code> file for macOS from the <a href=\"https://github.com/micio86dev/jobshell/releases/latest\">latest release</a>.",
      "guide.s1.2": "Open the <code>.dmg</code> and drag <strong>Jobshell</strong> into <strong>Applications</strong>.",
      "guide.s1.3": "Eject the disk image.",
      "guide.s2": "2. First launch (recommended way)",
      "guide.s2.1": "Open <strong>Applications</strong> and double-click <strong>Jobshell</strong>. macOS says it cannot verify the app. Click <strong>Done</strong>.",
      "guide.s2.2": "Open <strong>System Settings</strong> → <strong>Privacy &amp; Security</strong>.",
      "guide.s2.3": "Scroll down to the message <em>“Jobshell” was blocked to protect your Mac</em> and click <strong>Open Anyway</strong>.",
      "guide.s2.4": "Enter your Mac password (or use Touch ID). In the dialog that appears, click <strong>Open</strong>.",
      "guide.warn": "On macOS Sequoia and later, right-click → Open no longer bypasses this check. Use the Privacy &amp; Security path above. The button stays available for about an hour after the first blocked attempt.",
      "guide.s2b": "2b. First launch (Terminal alternative)",
      "guide.s2b.p": "If you prefer the Terminal, remove the download quarantine flag from the app only:",
      "guide.s2b.note": "The command removes the flag that macOS adds to files downloaded from the internet. It does not change system security settings. Run it only on the app you downloaded from the official repository.",
      "guide.updates": "Updates",
      "guide.updates.p": "Each new version is a new download, so the steps repeat the first time you install it.",
      "guide.more": "Something else?",
      "guide.more.p": "If the app still does not open, send the exact message macOS shows and your macOS version in an issue on <a href=\"https://github.com/micio86dev/jobshell/issues\">GitHub</a>."
    },

    it: {
      "home.title": "Jobshell: trova i lavori che corrispondono al tuo CV",
      "home.description": "Jobshell legge il tuo CV, costruisce il tuo profilo con l'AI e classifica le offerte di lavoro in base a quanto ti corrispondono, con i motivi di ogni corrispondenza.",
      "home.h1": "Trova i lavori che corrispondono al tuo CV.",
      "home.lead": "Jobshell legge il tuo CV, costruisce il tuo profilo con l'AI e classifica le offerte di lavoro in base a quanto ti corrispondono, mostrando il motivo di ogni corrispondenza.",
      "dl.mac": "Scarica per macOS",
      "dl.mac.small": "Apple Silicon (M1 e successivi) · .dmg",
      "dl.win": "Scarica per Windows",
      "dl.win.small": "Windows 10 e successivi · installer x64",
      "dl.linux": "Scarica per Linux",
      "dl.linux.small": "AppImage · x64",
      "home.note": "Le app non sono ancora firmate. macOS blocca il primo avvio: segui la <a href=\"/install-macos.html\">guida di installazione per macOS</a>. Anche Windows SmartScreen può mostrare un avviso. Il codice sorgente è pubblico su <a href=\"https://github.com/micio86dev/jobshell\">GitHub</a>.",
      "home.whatTitle": "Cosa fa",
      "f1.title": "Carica il tuo CV",
      "f1.text": "PDF, .txt o .md. Il file resta sul tuo computer.",
      "f2.title": "Un profilo costruito con l'AI",
      "f2.text": "Jobshell compila il tuo profilo dal CV e segnala i campi ancora mancanti.",
      "f3.title": "Offerte in classifica",
      "f3.text": "Ogni offerta ha un punteggio di corrispondenza e i motivi, così vedi perché è in quella posizione.",
      "f4.title": "Le tue chiavi restano al sicuro",
      "f4.text": "Le chiavi API stanno nel portachiavi del sistema operativo e le legge solo l'app.",
      "f5.title": "Inglese, italiano e spagnolo",
      "f5.text": "L'interfaccia dell'app è disponibile in tutte e tre le lingue e segue la lingua del sistema.",
      "home.statusTitle": "Stato",
      "home.status": "Jobshell è alla versione 0.1.2. Le build per macOS, Windows e Linux sono prodotte dal workflow di release; finora solo la build macOS è stata provata a mano. Vedi il <a href=\"https://github.com/micio86dev/jobshell/blob/main/CHANGELOG.md\">changelog</a> per il contenuto di ogni versione.",
      "home.footer": "Jobshell è rilasciato con licenza Apache-2.0. <a href=\"https://github.com/micio86dev/jobshell\">Codice su GitHub</a>.",

      "guide.title": "Installa Jobshell su macOS",
      "guide.description": "Come aprire Jobshell su macOS quando l'app non è firmata con un certificato Apple.",
      "guide.back": "← Jobshell",
      "guide.h1": "Installa Jobshell su macOS",
      "guide.intro": "Jobshell non è ancora firmato con un certificato sviluppatore Apple, quindi macOS blocca il primo avvio. I passaggi qui sotto lo aprono una volta; dopo parte normalmente. Vale per i Mac Apple Silicon (M1 e successivi), l'unica architettura prodotta dalla build attuale.",
      "guide.s1": "1. Scarica e installa",
      "guide.s1.1": "Scarica il file <code>.dmg</code> per macOS dall'<a href=\"https://github.com/micio86dev/jobshell/releases/latest\">ultima release</a>.",
      "guide.s1.2": "Apri il <code>.dmg</code> e trascina <strong>Jobshell</strong> in <strong>Applicazioni</strong>.",
      "guide.s1.3": "Espelli l'immagine disco.",
      "guide.s2": "2. Primo avvio (metodo consigliato)",
      "guide.s2.1": "Apri <strong>Applicazioni</strong> e fai doppio clic su <strong>Jobshell</strong>. macOS dice che non può verificare l'app. Clicca <strong>Fine</strong>.",
      "guide.s2.2": "Apri <strong>Impostazioni di Sistema</strong> → <strong>Privacy e sicurezza</strong>.",
      "guide.s2.3": "Scorri fino al messaggio <em>«Jobshell» è stato bloccato per proteggere il Mac</em> e clicca <strong>Apri comunque</strong>.",
      "guide.s2.4": "Inserisci la password del Mac (o usa Touch ID). Nella finestra che appare, clicca <strong>Apri</strong>.",
      "guide.warn": "Su macOS Sequoia e successivi, clic destro → Apri non basta più: usa il percorso Privacy e sicurezza qui sopra. Il pulsante resta disponibile per circa un'ora dal primo tentativo bloccato.",
      "guide.s2b": "2b. Primo avvio (alternativa dal Terminale)",
      "guide.s2b.p": "Se preferisci il Terminale, rimuovi il flag di quarantena solo dall'app:",
      "guide.s2b.note": "Il comando rimuove il flag che macOS aggiunge ai file scaricati da internet. Non cambia le impostazioni di sicurezza del sistema. Eseguilo solo sull'app scaricata dal repository ufficiale.",
      "guide.updates": "Aggiornamenti",
      "guide.updates.p": "Ogni nuova versione è un nuovo download, quindi i passaggi si ripetono alla prima installazione.",
      "guide.more": "Altro?",
      "guide.more.p": "Se l'app non si apre ancora, scrivi il messaggio esatto che macOS mostra e la tua versione di macOS in una issue su <a href=\"https://github.com/micio86dev/jobshell/issues\">GitHub</a>."
    },

    es: {
      "home.title": "Jobshell: encuentra los trabajos que encajan con tu CV",
      "home.description": "Jobshell lee tu CV, crea tu perfil con IA y ordena las ofertas de trabajo según lo bien que encajan contigo, con los motivos de cada coincidencia.",
      "home.h1": "Encuentra los trabajos que encajan con tu CV.",
      "home.lead": "Jobshell lee tu CV, crea tu perfil con IA y ordena las ofertas de trabajo según lo bien que encajan contigo, mostrando el motivo de cada coincidencia.",
      "dl.mac": "Descargar para macOS",
      "dl.mac.small": "Apple Silicon (M1 y posteriores) · .dmg",
      "dl.win": "Descargar para Windows",
      "dl.win.small": "Windows 10 y posteriores · instalador x64",
      "dl.linux": "Descargar para Linux",
      "dl.linux.small": "AppImage · x64",
      "home.note": "Las apps aún no están firmadas. macOS bloquea el primer inicio: sigue la <a href=\"/install-macos.html\">guía de instalación para macOS</a>. Windows SmartScreen también puede mostrar un aviso. El código fuente es público en <a href=\"https://github.com/micio86dev/jobshell\">GitHub</a>.",
      "home.whatTitle": "Qué hace",
      "f1.title": "Sube tu CV",
      "f1.text": "PDF, .txt o .md. El archivo se queda en tu ordenador.",
      "f2.title": "Un perfil creado con IA",
      "f2.text": "Jobshell rellena tu perfil a partir del CV y marca los campos que faltan.",
      "f3.title": "Ofertas ordenadas",
      "f3.text": "Cada oferta tiene una puntuación de coincidencia y sus motivos, para que veas por qué ocupa ese lugar.",
      "f4.title": "Tus claves están a salvo",
      "f4.text": "Las claves API se guardan en el llavero del sistema operativo y solo las lee la app.",
      "f5.title": "Inglés, italiano y español",
      "f5.text": "La interfaz de la app está disponible en los tres idiomas y sigue el idioma del sistema.",
      "home.statusTitle": "Estado",
      "home.status": "Jobshell está en la versión 0.1.2. Las versiones para macOS, Windows y Linux las genera el flujo de publicación; hasta ahora solo la de macOS se ha probado a mano. Consulta el <a href=\"https://github.com/micio86dev/jobshell/blob/main/CHANGELOG.md\">changelog</a> para ver qué incluye cada versión.",
      "home.footer": "Jobshell se publica con licencia Apache-2.0. <a href=\"https://github.com/micio86dev/jobshell\">Código en GitHub</a>.",

      "guide.title": "Instala Jobshell en macOS",
      "guide.description": "Cómo abrir Jobshell en macOS cuando la app no está firmada con un certificado de Apple.",
      "guide.back": "← Jobshell",
      "guide.h1": "Instala Jobshell en macOS",
      "guide.intro": "Jobshell aún no está firmado con un certificado de desarrollador de Apple, así que macOS bloquea el primer inicio. Los pasos siguientes lo abren una vez; después arranca normalmente. Vale para Mac Apple Silicon (M1 y posteriores), la única arquitectura que genera la versión actual.",
      "guide.s1": "1. Descarga e instala",
      "guide.s1.1": "Descarga el archivo <code>.dmg</code> para macOS desde la <a href=\"https://github.com/micio86dev/jobshell/releases/latest\">última versión</a>.",
      "guide.s1.2": "Abre el <code>.dmg</code> y arrastra <strong>Jobshell</strong> a <strong>Aplicaciones</strong>.",
      "guide.s1.3": "Expulsa la imagen de disco.",
      "guide.s2": "2. Primer inicio (método recomendado)",
      "guide.s2.1": "Abre <strong>Aplicaciones</strong> y haz doble clic en <strong>Jobshell</strong>. macOS dice que no puede verificar la app. Haz clic en <strong>Listo</strong>.",
      "guide.s2.2": "Abre <strong>Ajustes del Sistema</strong> → <strong>Privacidad y seguridad</strong>.",
      "guide.s2.3": "Desplázate hasta el mensaje <em>«Jobshell» se ha bloqueado para proteger tu Mac</em> y haz clic en <strong>Abrir igualmente</strong>.",
      "guide.s2.4": "Introduce la contraseña del Mac (o usa Touch ID). En la ventana que aparece, haz clic en <strong>Abrir</strong>.",
      "guide.warn": "En macOS Sequoia y posteriores, clic derecho → Abrir ya no basta: usa la ruta de Privacidad y seguridad de arriba. El botón queda disponible unos 60 minutos tras el primer intento bloqueado.",
      "guide.s2b": "2b. Primer inicio (alternativa con Terminal)",
      "guide.s2b.p": "Si prefieres Terminal, quita la marca de cuarentena solo de la app:",
      "guide.s2b.note": "El comando quita la marca que macOS añade a los archivos descargados de internet. No cambia la configuración de seguridad del sistema. Ejecútalo solo con la app descargada del repositorio oficial.",
      "guide.updates": "Actualizaciones",
      "guide.updates.p": "Cada versión nueva es una descarga nueva, así que los pasos se repiten en la primera instalación.",
      "guide.more": "¿Algo más?",
      "guide.more.p": "Si la app sigue sin abrirse, escribe el mensaje exacto que muestra macOS y tu versión de macOS en una issue en <a href=\"https://github.com/micio86dev/jobshell/issues\">GitHub</a>."
    }
  };

  function pickLanguage() {
    var tags = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || "en"];
    for (var i = 0; i < tags.length; i++) {
      var code = String(tags[i]).slice(0, 2).toLowerCase();
      if (SUPPORTED.indexOf(code) !== -1) return code;
    }
    return "en";
  }

  var lang = pickLanguage();
  var dict = DICT[lang];
  var root = document.documentElement;
  root.lang = lang;

  if (dict[root.getAttribute("data-title-key")]) {
    document.title = dict[root.getAttribute("data-title-key")];
  }
  var description = document.querySelector('meta[name="description"]');
  if (description && dict[root.getAttribute("data-description-key")]) {
    description.setAttribute("content", dict[root.getAttribute("data-description-key")]);
  }

  // The dictionary is our own static text, never user input, so innerHTML is safe here.
  var nodes = document.querySelectorAll("[data-i18n]");
  for (var n = 0; n < nodes.length; n++) {
    var value = dict[nodes[n].getAttribute("data-i18n")];
    if (value !== undefined) nodes[n].innerHTML = value;
  }
})();
