import { createOptionsModuleRunner } from './options-shared.js';

/**
 * Runner parametrizable para capturar cadenas de opciones de cualquier
 * subyacente. Utiliza `runSocketSniffer` y el interceptor de opciones para
 * generar CSV por expiración y *logs* Legend de soporte.
 *
 * Define símbolos explícitos con `--symbols` cuando se invoque desde CLI para
 * limitar la captura al subyacente deseado.
 */
export const runOptionsGenericModule = createOptionsModuleRunner(undefined);
