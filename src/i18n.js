// -----------------------------------------------------------------------------
// Runtime texts, in the four languages of the Gladys UI.
//
// `t(key, vars)` returns a multi-language object `{ en, fr, de, es }`
// (configuration buttons, widgets, connection status, transport badges);
// `text(key, language, vars)` returns one string (feature names, scene action
// errors: Gladys does not send the language of the user with a scan, a
// command or a scene action, see `language` in config.js).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

const MESSAGES = {
  // --- Feature names -----------------------------------------------------------
  feature_state: {
    en: 'Open / close',
    fr: 'Ouvrir / fermer',
    de: 'Öffnen / schließen',
    es: 'Abrir / cerrar',
  },
  feature_position: { en: 'Position', fr: 'Position', de: 'Position', es: 'Posición' },
  feature_tilt: { en: 'Slats', fr: 'Lames', de: 'Lamellen', es: 'Lamas' },
  feature_light: { en: 'Light', fr: 'Lumière', de: 'Licht', es: 'Luz' },
  feature_brightness: { en: 'Brightness', fr: 'Intensité', de: 'Helligkeit', es: 'Brillo' },
  feature_switch: { en: 'On / off', fr: 'Marche / arrêt', de: 'Ein / aus', es: 'Encendido' },
  feature_temperature: {
    en: 'Temperature',
    fr: 'Température',
    de: 'Temperatur',
    es: 'Temperatura',
  },
  feature_luminance: {
    en: 'Light level',
    fr: 'Luminosité',
    de: 'Lichtstärke',
    es: 'Luminosidad',
  },
  feature_humidity: { en: 'Humidity', fr: 'Humidité', de: 'Luftfeuchtigkeit', es: 'Humedad' },
  feature_contact: { en: 'Opening', fr: 'Ouverture', de: 'Öffnung', es: 'Apertura' },
  feature_motion: { en: 'Motion', fr: 'Mouvement', de: 'Bewegung', es: 'Movimiento' },
  feature_smoke: { en: 'Smoke', fr: 'Fumée', de: 'Rauch', es: 'Humo' },
  feature_leak: { en: 'Water leak', fr: 'Fuite d’eau', de: 'Wasserleck', es: 'Fuga de agua' },
  feature_battery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  feature_battery_low: {
    en: 'Low battery',
    fr: 'Batterie faible',
    de: 'Batterie schwach',
    es: 'Batería baja',
  },
  feature_co2: { en: 'CO2', fr: 'CO2', de: 'CO2', es: 'CO2' },
  feature_power: { en: 'Power', fr: 'Puissance', de: 'Leistung', es: 'Potencia' },
  feature_energy: { en: 'Energy', fr: 'Énergie', de: 'Energie', es: 'Energía' },

  // --- Channels and their failures ------------------------------------------------
  channel_local: { en: 'local API', fr: 'API locale', de: 'lokale API', es: 'API local' },
  channel_cloud: {
    en: 'Somfy cloud',
    fr: 'cloud Somfy',
    de: 'Somfy-Cloud',
    es: 'nube de Somfy',
  },
  reasonLine: {
    en: '{channel}: {reason}',
    fr: '{channel} : {reason}',
    de: '{channel}: {reason}',
    es: '{channel}: {reason}',
  },
  reasonToken: {
    en: 'the box refused the local token',
    fr: 'la box a refusé le jeton local',
    de: 'die Box hat das lokale Token abgelehnt',
    es: 'la caja rechazó el token local',
  },
  reasonPassword: {
    en: 'Somfy refused the e-mail or the password',
    fr: 'Somfy a refusé l’e-mail ou le mot de passe',
    de: 'Somfy hat die E-Mail-Adresse oder das Passwort abgelehnt',
    es: 'Somfy rechazó el correo o la contraseña',
  },
  reasonRate: {
    en: 'too many requests, Somfy asks to wait',
    fr: 'trop de requêtes, Somfy demande d’attendre',
    de: 'zu viele Anfragen, Somfy verlangt eine Pause',
    es: 'demasiadas solicitudes, Somfy pide esperar',
  },
  reasonMaintenance: {
    en: 'Somfy servers under maintenance',
    fr: 'serveurs Somfy en maintenance',
    de: 'Somfy-Server in Wartung',
    es: 'servidores de Somfy en mantenimiento',
  },
  reasonTls: {
    en: 'the certificate is not the one of a TaHoma box',
    fr: 'le certificat n’est pas celui d’une box TaHoma',
    de: 'das Zertifikat ist nicht das einer TaHoma-Box',
    es: 'el certificado no es el de una caja TaHoma',
  },
  reasonNetwork: {
    en: 'no answer',
    fr: 'pas de réponse',
    de: 'keine Antwort',
    es: 'sin respuesta',
  },
  reasonNoHost: {
    en: 'box not found on the local network, type its IP address',
    fr: 'box introuvable sur le réseau local, saisissez son adresse IP',
    de: 'Box im lokalen Netzwerk nicht gefunden, geben Sie ihre IP-Adresse ein',
    es: 'caja no encontrada en la red local, escriba su dirección IP',
  },
  reasonOther: { en: '{message}', fr: '{message}', de: '{message}', es: '{message}' },
  reasonUnknown: {
    en: 'unknown error',
    fr: 'erreur inconnue',
    de: 'unbekannter Fehler',
    es: 'error desconocido',
  },

  // --- Transport badges (orange dot, 200 characters at most) -----------------------
  degradedCloud: {
    en: 'Through the Somfy cloud: the local API does not answer ({reason}).',
    fr: 'Via le cloud Somfy : l’API locale ne répond pas ({reason}).',
    de: 'Über die Somfy-Cloud: Die lokale API antwortet nicht ({reason}).',
    es: 'A través de la nube de Somfy: la API local no responde ({reason}).',
  },
  degradedLocal: {
    en: 'Through the local API: the Somfy cloud does not answer ({reason}).',
    fr: 'Via l’API locale : le cloud Somfy ne répond pas ({reason}).',
    de: 'Über die lokale API: Die Somfy-Cloud antwortet nicht ({reason}).',
    es: 'A través de la API local: la nube de Somfy no responde ({reason}).',
  },

  // --- Connection status (Integrations page) -----------------------------------
  statusNotConfigured: {
    en: 'Enter your TaHoma account, a local token, or both, then save.',
    fr: 'Saisissez votre compte TaHoma, un jeton local, ou les deux, puis enregistrez.',
    de: 'Geben Sie Ihr TaHoma-Konto, ein lokales Token oder beides ein und speichern Sie.',
    es: 'Introduzca su cuenta TaHoma, un token local o ambos, y guarde.',
  },
  statusLocal: {
    en: 'Connected to box {pin} on the local network, {devices} device(s).',
    fr: 'Connecté à la box {pin} sur le réseau local, {devices} appareil(s).',
    de: 'Mit der Box {pin} im lokalen Netzwerk verbunden, {devices} Gerät(e).',
    es: 'Conectado a la caja {pin} en la red local, {devices} dispositivo(s).',
  },
  statusCloud: {
    en: 'Connected to box {pin} through the Somfy cloud, {devices} device(s).',
    fr: 'Connecté à la box {pin} via le cloud Somfy, {devices} appareil(s).',
    de: 'Mit der Box {pin} über die Somfy-Cloud verbunden, {devices} Gerät(e).',
    es: 'Conectado a la caja {pin} a través de la nube de Somfy, {devices} dispositivo(s).',
  },
  statusCloudFallback: {
    en: 'Connected to box {pin} through the Somfy cloud, {devices} device(s). The local API does not answer: {reason}. Tried again every 5 minutes.',
    fr: 'Connecté à la box {pin} via le cloud Somfy, {devices} appareil(s). L’API locale ne répond pas : {reason}. Nouvel essai toutes les 5 minutes.',
    de: 'Mit der Box {pin} über die Somfy-Cloud verbunden, {devices} Gerät(e). Die lokale API antwortet nicht: {reason}. Neuer Versuch alle 5 Minuten.',
    es: 'Conectado a la caja {pin} a través de la nube de Somfy, {devices} dispositivo(s). La API local no responde: {reason}. Nuevo intento cada 5 minutos.',
  },
  statusLocalFallback: {
    en: 'Connected to box {pin} on the local network, {devices} device(s). The Somfy cloud does not answer: {reason}. Tried again every 5 minutes.',
    fr: 'Connecté à la box {pin} sur le réseau local, {devices} appareil(s). Le cloud Somfy ne répond pas : {reason}. Nouvel essai toutes les 5 minutes.',
    de: 'Mit der Box {pin} im lokalen Netzwerk verbunden, {devices} Gerät(e). Die Somfy-Cloud antwortet nicht: {reason}. Neuer Versuch alle 5 Minuten.',
    es: 'Conectado a la caja {pin} en la red local, {devices} dispositivo(s). La nube de Somfy no responde: {reason}. Nuevo intento cada 5 minutos.',
  },
  statusUnreachable: {
    en: 'Box unreachable. {reasons}.',
    fr: 'Box injoignable. {reasons}.',
    de: 'Box nicht erreichbar. {reasons}.',
    es: 'Caja inaccesible. {reasons}.',
  },

  // --- Configuration buttons ----------------------------------------------------
  testScenarios: {
    en: '{count} TaHoma scenario(s) read.',
    fr: '{count} scénario(s) TaHoma lu(s).',
    de: '{count} TaHoma-Szenario(s) gelesen.',
    es: '{count} escenario(s) TaHoma leído(s).',
  },
  enableLocalOk: {
    en: 'Local mode on: Developer Mode enabled on box {pin}, token “Gladys Assistant” created, Gladys now talks to the box on the local network.',
    fr: 'Mode local activé : mode développeur allumé sur la box {pin}, jeton « Gladys Assistant » créé, Gladys parle maintenant à la box sur le réseau local.',
    de: 'Lokaler Modus aktiv: Entwicklermodus auf der Box {pin} eingeschaltet, Token „Gladys Assistant“ erstellt, Gladys spricht jetzt im lokalen Netzwerk mit der Box.',
    es: 'Modo local activado: modo desarrollador encendido en la caja {pin}, token «Gladys Assistant» creado, Gladys habla ahora con la caja en la red local.',
  },
  enableLocalPending: {
    en: 'Developer Mode enabled on box {pin} and token “Gladys Assistant” created, but the local API does not answer yet: {reason}. Gladys stays on the cloud and tries again every 5 minutes.',
    fr: 'Mode développeur allumé sur la box {pin} et jeton « Gladys Assistant » créé, mais l’API locale ne répond pas encore : {reason}. Gladys reste sur le cloud et réessaie toutes les 5 minutes.',
    de: 'Entwicklermodus auf der Box {pin} eingeschaltet und Token „Gladys Assistant“ erstellt, aber die lokale API antwortet noch nicht: {reason}. Gladys bleibt in der Cloud und versucht es alle 5 Minuten erneut.',
    es: 'Modo desarrollador encendido en la caja {pin} y token «Gladys Assistant» creado, pero la API local aún no responde: {reason}. Gladys sigue en la nube y lo vuelve a intentar cada 5 minutos.',
  },
  enableLocalNoAccount: {
    en: 'Enter and save your TaHoma account first: the local token is created through it.',
    fr: 'Saisissez et enregistrez d’abord votre compte TaHoma : le jeton local est créé grâce à lui.',
    de: 'Geben Sie zuerst Ihr TaHoma-Konto ein und speichern Sie es: Das lokale Token wird darüber erstellt.',
    es: 'Introduzca y guarde primero su cuenta TaHoma: el token local se crea a través de ella.',
  },
  enableLocalNoBox: {
    en: 'No TaHoma box on this account.',
    fr: 'Aucune box TaHoma sur ce compte.',
    de: 'Keine TaHoma-Box in diesem Konto.',
    es: 'No hay ninguna caja TaHoma en esta cuenta.',
  },
  enableLocalFailed: {
    en: 'Local mode could not be enabled: {reason}. You can also create a token in the TaHoma app (Developer Mode) and paste it below.',
    fr: 'Impossible d’activer le mode local : {reason}. Vous pouvez aussi créer un jeton dans l’application TaHoma (mode développeur) et le coller ci-dessous.',
    de: 'Der lokale Modus konnte nicht aktiviert werden: {reason}. Sie können auch in der TaHoma-App (Entwicklermodus) ein Token erstellen und unten einfügen.',
    es: 'No se pudo activar el modo local: {reason}. También puede crear un token en la aplicación TaHoma (modo desarrollador) y pegarlo abajo.',
  },

  // --- Errors of commands and scene actions ---------------------------------------
  errorUnknownDevice: {
    en: '{name} is not on the TaHoma box any more.',
    fr: '{name} n’est plus sur la box TaHoma.',
    de: '{name} ist nicht mehr auf der TaHoma-Box.',
    es: '{name} ya no está en la caja TaHoma.',
  },
  errorUnreachable: {
    en: 'The TaHoma box is unreachable: {name} cannot be controlled.',
    fr: 'La box TaHoma est injoignable : impossible de piloter {name}.',
    de: 'Die TaHoma-Box ist nicht erreichbar: {name} kann nicht gesteuert werden.',
    es: 'La caja TaHoma es inaccesible: no se puede controlar {name}.',
  },
  errorBoxUnreachable: {
    en: 'The TaHoma box is unreachable: scenario “{name}” not run.',
    fr: 'La box TaHoma est injoignable : scénario « {name} » non lancé.',
    de: 'Die TaHoma-Box ist nicht erreichbar: Szenario „{name}“ nicht gestartet.',
    es: 'La caja TaHoma es inaccesible: escenario «{name}» no ejecutado.',
  },
  errorRefused: {
    en: 'The TaHoma box refused the command for {name}: {error}',
    fr: 'La box TaHoma a refusé la commande pour {name} : {error}',
    de: 'Die TaHoma-Box hat den Befehl für {name} abgelehnt: {error}',
    es: 'La caja TaHoma rechazó la orden para {name}: {error}',
  },
  errorValue: {
    en: 'Value out of range: {value}.',
    fr: 'Valeur hors limites : {value}.',
    de: 'Wert außerhalb des Bereichs: {value}.',
    es: 'Valor fuera de rango: {value}.',
  },
  errorCommand: {
    en: '{name} does not take the command “{command}”.',
    fr: '{name} n’accepte pas la commande « {command} ».',
    de: '{name} unterstützt den Befehl „{command}“ nicht.',
    es: '{name} no acepta la orden «{command}».',
  },
  errorScenario: {
    en: 'Scenario “{name}” refused: {error}',
    fr: 'Scénario « {name} » refusé : {error}',
    de: 'Szenario „{name}“ abgelehnt: {error}',
    es: 'Escenario «{name}» rechazado: {error}',
  },
  errorNoScenario: {
    en: 'No TaHoma scenario named “{name}”.',
    fr: 'Aucun scénario TaHoma ne s’appelle « {name} ».',
    de: 'Kein TaHoma-Szenario heißt „{name}“.',
    es: 'Ningún escenario TaHoma se llama «{name}».',
  },
  errorScenariosNeedCloud: {
    en: 'Scenario “{name}” unknown: the TaHoma scenarios are read through the TaHoma account, enter it in the configuration.',
    fr: 'Scénario « {name} » inconnu : les scénarios TaHoma sont lus via le compte TaHoma, saisissez-le dans la configuration.',
    de: 'Szenario „{name}“ unbekannt: Die TaHoma-Szenarien werden über das TaHoma-Konto gelesen, geben Sie es in der Konfiguration ein.',
    es: 'Escenario «{name}» desconocido: los escenarios TaHoma se leen a través de la cuenta TaHoma, introdúzcala en la configuración.',
  },

  // --- Widgets --------------------------------------------------------------------
  stateUnreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  stateMoving: { en: 'Moving', fr: 'En mouvement', de: 'In Bewegung', es: 'En movimiento' },
  stateOpen: { en: 'Open', fr: 'Ouvert', de: 'Offen', es: 'Abierto' },
  stateClosed: { en: 'Closed', fr: 'Fermé', de: 'Geschlossen', es: 'Cerrado' },
  stateOpenAt: {
    en: 'Open {position} %',
    fr: 'Ouvert à {position} %',
    de: '{position} % offen',
    es: 'Abierto al {position} %',
  },
  statePartly: {
    en: 'Partly open',
    fr: 'Entrouvert',
    de: 'Teilweise offen',
    es: 'Entreabierto',
  },
  stateUnknown: {
    en: 'No feedback',
    fr: 'Sans retour d’état',
    de: 'Ohne Rückmeldung',
    es: 'Sin respuesta de estado',
  },
  widgetChooseDevice: {
    en: 'Choose a cover in the settings of the widget.',
    fr: 'Choisissez un volet dans les réglages du widget.',
    de: 'Wählen Sie einen Behang in den Einstellungen des Widgets.',
    es: 'Elija una persiana en los ajustes del widget.',
  },
  widgetOpen: { en: 'Open', fr: 'Ouverture', de: 'Öffnung', es: 'Apertura' },
  widgetOpenCurtain: { en: 'Open', fr: 'Ouverture', de: 'Öffnung', es: 'Apertura' },
  widgetState: { en: 'State', fr: 'État', de: 'Zustand', es: 'Estado' },
  widgetTilt: { en: 'Slats', fr: 'Lames', de: 'Lamellen', es: 'Lamas' },
  widgetMy: {
    en: '“My” position',
    fr: 'Position « My »',
    de: '„My“-Position',
    es: 'Posición «My»',
  },
  widgetOffline: {
    en: 'The TaHoma box or this device does not answer.',
    fr: 'La box TaHoma ou cet appareil ne répond pas.',
    de: 'Die TaHoma-Box oder dieses Gerät antwortet nicht.',
    es: 'La caja TaHoma o este dispositivo no responde.',
  },
  widgetToggle: { en: 'Open / close', fr: 'Ouvrir / fermer', de: 'Auf / zu', es: 'Abrir / cerrar' },
  widgetOpenButton: { en: 'Open', fr: 'Ouvrir', de: 'Öffnen', es: 'Abrir' },
  widgetStop: { en: 'Stop', fr: 'Stop', de: 'Stopp', es: 'Parar' },
  widgetMyButton: { en: 'My', fr: 'My', de: 'My', es: 'My' },
  widgetClose: { en: 'Close', fr: 'Fermer', de: 'Schließen', es: 'Cerrar' },
  widgetDone: {
    en: '“My” sent to {name}.',
    fr: '« My » envoyé à {name}.',
    de: '„My“ an {name} gesendet.',
    es: '«My» enviado a {name}.',
  },
  widgetNoCover: {
    en: 'No TaHoma cover added to Gladys yet: add them from the Discover tab.',
    fr: 'Aucun volet TaHoma ajouté à Gladys pour l’instant : ajoutez-les depuis l’onglet Découverte.',
    de: 'Noch kein TaHoma-Behang in Gladys: Fügen Sie sie im Tab Erkennung hinzu.',
    es: 'Aún no hay persianas TaHoma en Gladys: añádalas desde la pestaña Descubrir.',
  },
  widgetNoCoverNamed: {
    en: 'None of the covers named in the settings of this widget is in Gladys.',
    fr: 'Aucun des volets nommés dans les réglages de ce widget n’est dans Gladys.',
    de: 'Keiner der in den Widget-Einstellungen genannten Behänge ist in Gladys.',
    es: 'Ninguna de las persianas nombradas en los ajustes del widget está en Gladys.',
  },
  widgetMoreCovers: {
    en: '+ {count} other cover(s)',
    fr: '+ {count} autre(s) volet(s)',
    de: '+ {count} weitere(r) Behang/Behänge',
    es: '+ {count} persiana(s) más',
  },
  widgetSummary: {
    en: '{open} open out of {total}',
    fr: '{open} ouvert(s) sur {total}',
    de: '{open} von {total} offen',
    es: '{open} abierto(s) de {total}',
  },
  widgetBox: { en: 'Box', fr: 'Box', de: 'Box', es: 'Caja' },
  widgetLocal: {
    en: 'Local network',
    fr: 'Réseau local',
    de: 'Lokales Netzwerk',
    es: 'Red local',
  },
  widgetCloud: { en: 'Somfy cloud', fr: 'Cloud Somfy', de: 'Somfy-Cloud', es: 'Nube Somfy' },
  widgetUnreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  widgetNotConfigured: {
    en: 'Not configured',
    fr: 'Non configurée',
    de: 'Nicht eingerichtet',
    es: 'Sin configurar',
  },
  widgetFirmware: { en: 'Firmware', fr: 'Micrologiciel', de: 'Firmware', es: 'Firmware' },
  widgetDevices: { en: 'Devices', fr: 'Appareils', de: 'Geräte', es: 'Dispositivos' },
  widgetDevicesCount: {
    en: '{count} in Gladys',
    fr: '{count} dans Gladys',
    de: '{count} in Gladys',
    es: '{count} en Gladys',
  },
  widgetUnavailable: {
    en: 'Not answering',
    fr: 'Sans réponse',
    de: 'Antworten nicht',
    es: 'Sin respuesta',
  },
  widgetRefresh: {
    en: 'Read states',
    fr: 'Relire les états',
    de: 'Zustände lesen',
    es: 'Leer estados',
  },
  widgetRefreshed: {
    en: 'States read again.',
    fr: 'États relus.',
    de: 'Zustände neu gelesen.',
    es: 'Estados leídos de nuevo.',
  },
  widgetRefreshFailed: {
    en: 'Reading failed: {reason}.',
    fr: 'Échec de la lecture : {reason}.',
    de: 'Lesen fehlgeschlagen: {reason}.',
    es: 'Error de lectura: {reason}.',
  },
  widgetScenariosNeedCloud: {
    en: 'The TaHoma scenarios are read through the TaHoma account: enter it in the configuration.',
    fr: 'Les scénarios TaHoma sont lus via le compte TaHoma : saisissez-le dans la configuration.',
    de: 'Die TaHoma-Szenarien werden über das TaHoma-Konto gelesen: Geben Sie es in der Konfiguration ein.',
    es: 'Los escenarios TaHoma se leen a través de la cuenta TaHoma: introdúzcala en la configuración.',
  },
  widgetNoScenario: {
    en: 'No TaHoma scenario found (or none with this name).',
    fr: 'Aucun scénario TaHoma trouvé (ou aucun de ce nom).',
    de: 'Kein TaHoma-Szenario gefunden (oder keines mit diesem Namen).',
    es: 'No se encontró ningún escenario TaHoma (o ninguno con este nombre).',
  },
  widgetScenarioActions: {
    en: '{count} device(s)',
    fr: '{count} appareil(s)',
    de: '{count} Gerät(e)',
    es: '{count} dispositivo(s)',
  },
  widgetScenarioRun: {
    en: 'Scenario “{name}” started.',
    fr: 'Scénario « {name} » lancé.',
    de: 'Szenario „{name}“ gestartet.',
    es: 'Escenario «{name}» iniciado.',
  },
  widgetScenarioGone: {
    en: 'This scenario no longer exists.',
    fr: 'Ce scénario n’existe plus.',
    de: 'Dieses Szenario existiert nicht mehr.',
    es: 'Este escenario ya no existe.',
  },
};

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] === undefined || vars[name] === null ? match : String(vars[name]),
  );
}

/**
 * @description A runtime text in the four languages.
 * @param {string} key - Message key.
 * @param {object} [vars] - Placeholder values, a value may itself be multi-language.
 * @returns {{en: string, fr: string, de: string, es: string}} The message.
 */
export function t(key, vars = {}) {
  return Object.fromEntries(LANGUAGES.map((language) => [language, text(key, language, vars)]));
}

/**
 * @description A runtime text in one language (English when unknown).
 * @param {string} key - Message key.
 * @param {string} language - Language code.
 * @param {object} [vars] - Placeholder values, a value may itself be multi-language.
 * @returns {string} The text.
 */
export function text(key, language, vars = {}) {
  const message = MESSAGES[key];
  if (!message) {
    throw new Error(`Unknown message ${key}`);
  }
  const lang = LANGUAGES.includes(language) ? language : 'en';
  const resolved = Object.fromEntries(
    Object.entries(vars).map(([name, value]) => [name, pick(value, lang)]),
  );
  return fill(message[lang], resolved);
}

/**
 * @description One language of a value that may be multi-language.
 * @param {*} value - A string, a number or `{ en, fr, ... }`.
 * @param {string} language - Language code.
 * @returns {*} The value in that language.
 */
export function pick(value, language) {
  if (value && typeof value === 'object') {
    return value[language] ?? value.en;
  }
  return value;
}

/**
 * @description Cut a text to a maximum length, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - Maximum length.
 * @returns {string} The text, at most `max` characters.
 */
export function truncate(value, max) {
  const string = String(value ?? '');
  return string.length <= max ? string : `${string.slice(0, max - 1).trimEnd()}…`;
}

/**
 * @description Cut every language of a multi-language text.
 * @param {object} message - `{ en, fr, ... }`.
 * @param {number} max - Maximum length.
 * @returns {object} The message.
 */
export function truncateAll(message, max) {
  return Object.fromEntries(
    Object.entries(message).map(([language, value]) => [language, truncate(value, max)]),
  );
}

export const MESSAGE_KEYS = Object.keys(MESSAGES);
export const MESSAGES_FOR_TESTS = MESSAGES;
