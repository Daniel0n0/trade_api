# Paso 0 – Checklist de arranque

Usa esta lista antes de automatizar sesiones contra Robinhood o ejecutar el orquestador.

1. **Revisa la advertencia legal y las políticas vigentes de Robinhood.** Asegúrate de que el uso previsto cumple los Términos de Servicio y cualquier normativa aplicable.
2. **Confirma dependencias instaladas.** Ejecuta `npm install` y `npx playwright install chromium` en un entorno con Node.js 20 o superior.
3. **Prepara variables de entorno.** Copia `.env.example` a `.env` y personaliza flags en `.env.local` según sea necesario (headless, DevTools, depuración).
4. **Verifica autenticación manual.** Ten a la mano credenciales y dispositivo MFA para completar el primer login dentro del navegador automatizado.
5. **Configura almacenamiento local.** Crea las carpetas `data/` y `logs/` si deseas rutas personalizadas y asegúrate de contar con permisos de escritura.
6. **Planifica el cierre controlado.** Familiarízate con la combinación `Ctrl+C` (SIGINT) y el script `npm run clean:profile` para limpiar la sesión si ocurre un fallo.

Marca cada punto antes de avanzar al siguiente paso de la guía o de lanzar módulos especializados.
