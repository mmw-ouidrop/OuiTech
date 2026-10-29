// Services des fiches méthodes et des machines, branchés sur la base locale, le serveur et l'état du réseau.
import * as store from '../db.js'
import { api } from './api.js'
import { online } from './online.js'
import { createMethodsService, createMachinesService } from './methods.js'

export const methods = createMethodsService({ store, api, isOnline: () => online.value })
export const machines = createMachinesService({ store: store.machinesCatalog, api, isOnline: () => online.value })
