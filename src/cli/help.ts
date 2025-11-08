import { Command } from 'commander';

const INTRO = `CLI del orquestador de Trade API.

Los argumentos se pueden definir vía CLI, archivos YAML y variables de entorno.
La precedencia es: CLI > archivo de configuración > variables de entorno > valores por defecto.`;

const EXAMPLES = `
Ejemplos:
  trade-api start quotes stream --persist-cookies false
  trade-api stop 123e4567-e89b-12d3-a456-426614174000
  trade-api status --json
  trade-api run-config jobs.yaml --action stream
`;

export function attachHelp(program: Command): void {
  program.addHelpText('beforeAll', `${INTRO}\n`);
  program.addHelpText('afterAll', EXAMPLES);
  program.configureHelp({
    commandUsage: () => 'trade-api <comando> [opciones]',
  });
}
