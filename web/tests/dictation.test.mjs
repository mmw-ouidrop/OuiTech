import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSpoken, spokenCommand, cleanSpoken, mergeText, numberFromSpeech, describeError, dictationSupported, createDictation } from '../src/lib/dictation.js'

test('ordres vocaux : seulement quand toute la phrase est l’ordre', () => {
  assert.equal(spokenCommand('Champ suivant'), 'next')
  assert.equal(spokenCommand(' suivant. '), 'next')
  assert.equal(spokenCommand('Arrêt'), 'stop')
  assert.equal(spokenCommand('travail terminé'), null, 'un mot courant dans une phrase reste du texte')
  assert.equal(spokenCommand('Stop'), 'stop')
  assert.equal(spokenCommand('Terminé'), 'stop')
  assert.equal(spokenCommand('la prise est suivante au compteur'), null)
  assert.equal(spokenCommand('stop au compteur'), null)
})

test('ordre dit en fin de phrase : retiré du texte (« stoppe » compris)', () => {
  assert.deepEqual(parseSpoken('je voudrais tester cette fonctionnalité vocale stoppe'), { text: 'je voudrais tester cette fonctionnalité vocale', command: 'stop' })
  assert.deepEqual(parseSpoken('compteur remplacé. Stop'), { text: 'compteur remplacé.', command: 'stop' })
  assert.deepEqual(parseSpoken('câble vérifié champ suivant'), { text: 'câble vérifié', command: 'next' })
  assert.deepEqual(parseSpoken('fin de la dictée'), { text: '', command: 'stop' })
  assert.deepEqual(parseSpoken('il faut stopper la fuite'), { text: 'il faut stopper la fuite', command: null })
  assert.deepEqual(parseSpoken('prochain champ'), { text: 'prochain champ', command: null })
  assert.deepEqual(parseSpoken('stop'), { text: '', command: 'stop' })
})

test('texte dicté : ponctuation et retours à la ligne dits à voix haute', () => {
  assert.equal(cleanSpoken('  prise défectueuse virgule remplacée  '), 'prise défectueuse, remplacée')
  assert.equal(cleanSpoken('compteur changé à la ligne câble vérifié'), 'compteur changé\ncâble vérifié')
  assert.equal(cleanSpoken('tout est en ordre point final'), 'tout est en ordre.')
  assert.equal(cleanSpoken('vous avez compris point d’interrogation'), 'vous avez compris?')
  assert.equal(cleanSpoken('point de vente'), 'point de vente', 'un mot « point » reste du texte')
  assert.equal(cleanSpoken('nouvelle ligne'), '')
})

test('ajout au texte existant : espacement', () => {
  assert.equal(mergeText('', 'bonjour'), 'bonjour')
  assert.equal(mergeText('Prise HS', 'remplacée'), 'Prise HS remplacée')
  assert.equal(mergeText('Prise HS\n', 'remplacée'), 'Prise HS\nremplacée')
  assert.equal(mergeText('Prise HS', ', remplacée'), 'Prise HS, remplacée')
  assert.equal(mergeText('Prise HS', '\nsuite'), 'Prise HS\nsuite')
  assert.equal(mergeText(undefined, 'a'), 'a')
  assert.equal(mergeText('abc', ''), 'abc')
})

test('nombres dits à voix haute', () => {
  assert.equal(numberFromSpeech('12,5'), 12.5)
  assert.equal(numberFromSpeech('douze virgule 5'), 12.5)
  assert.equal(numberFromSpeech('1 200'), 1200)
  assert.equal(numberFromSpeech('moins 3'), -3)
  assert.equal(numberFromSpeech('quinze'), 15)
  assert.equal(numberFromSpeech('vingt trois'), 23)
  assert.equal(numberFromSpeech('rien'), null)
  assert.equal(numberFromSpeech(''), null)
})

test('erreurs lisibles ; sans API vocale : indisponible, jamais d’exception', () => {
  assert.match(describeError('not-allowed'), /Micro non autorisé/)
  assert.match(describeError('network'), /réseau/)
  assert.match(describeError('autre'), /arrêtée/)
  assert.equal(dictationSupported(), false)
  assert.equal(createDictation({}), null)
})

test('dictée avec une API vocale simulée : phrases cumulatives remplacées, ordre de fin de phrase, relance après silence, arrêt après trois silences', () => {
  const instances = []
  class Fake {
    constructor() { instances.push(this) }
    start() { this.started = true }
    stop() { this.stopped = true }
  }
  globalThis.webkitSpeechRecognition = Fake
  try {
    const log = []
    let text = ''
    const d = createDictation({
      onText: (t) => { text = t }, onInterim: (t) => t && log.push('interim:' + t),
      onEnd: (r) => log.push('end:' + r), onError: (c) => log.push('error:' + c), onCommand: (c) => log.push('cmd:' + c)
    })
    assert.equal(d.start(), true)
    const res = (items) => ({ resultIndex: 0, results: items.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) })
    const final = (i, t) => i.onresult(res([[t, true]]))
    // Android : chaque brouillon arrive comme « phrase finale » — ce que l'utilisateur a vraiment dicté (test réel)
    for (const t of ['je', 'je', 'je voudrais', 'je voudrais', 'je voudrais', 'je voudrais tester', 'je voudrais tester', 'je voudrais tester cette', 'je voudrais tester cette fonctionnalité', 'je voudrais tester cette fonctionnalité', 'je voudrais tester cette fonctionnalité vocale']) final(instances[0], t)
    assert.equal(text, 'je voudrais tester cette fonctionnalité vocale')
    // le navigateur coupe seul après un silence : relance ; la phrase suivante s'ajoute
    instances[0].onend()
    assert.equal(instances.length, 2)
    assert.equal(d.listening, true)
    final(instances[1], 'et le câble')
    assert.equal(text, 'je voudrais tester cette fonctionnalité vocale et le câble')
    // « stoppe » collé à la fin de la phrase : texte gardé, micro coupé
    final(instances[1], 'et le câble est bon stoppe')
    assert.equal(text, 'je voudrais tester cette fonctionnalité vocale et le câble est bon')
    assert.deepEqual(log.slice(-2), ['cmd:stop', 'end:stop'])
    assert.equal(d.listening, false)
    // une nouvelle dictée repart de zéro
    log.length = 0
    text = ''
    d.start()
    final(instances.at(-1), 'câble vérifié champ suivant')
    assert.equal(text, 'câble vérifié')
    assert.deepEqual(log, ['cmd:next', 'end:command'])
    // trois écoutes silencieuses d'affilée : arrêt
    log.length = 0
    d.start()
    const n = instances.length
    instances.at(-1).onend(); instances.at(-1).onend(); instances.at(-1).onend()
    assert.equal(d.listening, false)
    assert.equal(log.at(-1), 'end:ended')
    assert.equal(instances.length, n + 2)
    // erreur de micro : signalée puis arrêt
    log.length = 0
    d.start()
    instances.at(-1).onerror({ error: 'not-allowed' })
    assert.deepEqual(log, ['error:not-allowed', 'end:error'])
  } finally {
    delete globalThis.webkitSpeechRecognition
  }
})
