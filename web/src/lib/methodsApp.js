// Service des fiches méthodes branché sur la base locale, le serveur et l'état du réseau.
import * as store from '../db.js'
import { api } from './api.js'
import { online } from './online.js'
import { createMethodsService } from './methods.js'

export const methods = createMethodsService({ store, api, isOnline: () => online.value })
