# Somfy TaHoma

## Presentación

Esta integración trae una **caja Somfy TaHoma** (TaHoma, TaHoma Switch,
TaHoma Beecon, Connexoon) a Gladys: persianas, estores, screens, toldos,
cortinas, ventanas de tejado, pérgolas, puertas de garaje y portones
(io-homecontrol y RTS), luces, enchufes y los sensores de la caja.

Accede a la caja de dos maneras:

- **en la red local**, con la API local del modo desarrollador de Somfy:
  órdenes y estados ya no pasan por Somfy y funcionan sin internet;
- **a través de la nube de Somfy**, con la cuenta de la aplicación TaHoma.

Primero en local por defecto, la nube como respaldo. Gladys muestra en cada
dispositivo cuál se usa.

La tienda de Gladys ya ofrece una integración **Overkiz** (de cicoub13), solo
en la nube, que cubre también las cuentas Atlantic Cozytouch, Flexom, Rexel
e Hitachi. Esta está dedicada a las cajas Somfy y añade el modo local.

Sin relación con Somfy.

## Requisitos

- Gladys Assistant 5.3.0 o posterior.
- Una caja TaHoma, TaHoma Switch, TaHoma Beecon o Connexoon configurada en
  la aplicación TaHoma.
- Para el modo local: una caja compatible con el modo desarrollador (no la
  primera TaHoma cuadrada, no el kit de conectividad), en la misma red que
  Gladys.
- Para la nube y los escenarios TaHoma: el correo y la contraseña de la
  aplicación TaHoma.

## Configuración

### Cuenta TaHoma

Elija la **región** de su cuenta (Europa para la mayoría), escriba el
**correo** y la **contraseña** de la aplicación TaHoma y guarde. Gladys se
conecta una vez y luego renueva su acceso sola: Somfy bloquea una cuenta que
se conecta demasiado a menudo.

La cuenta es opcional si solo usa el modo local, pero es necesaria para los
escenarios TaHoma y para el botón **Activar el modo local**.

### Modo local

Lo más sencillo: guarde su cuenta y pulse **Activar el modo local**. Gladys
enciende el modo desarrollador de la caja, crea un token llamado «Gladys
Assistant» y pasa a la red local.

A mano: en la aplicación TaHoma, **Configurar la instalación › parámetros de
la caja**, toque 7 veces el PIN de la caja (del tipo 1234-5678-9012) para
abrir el **modo desarrollador**, cree un token y péguelo en **Token local**.

Gladys encuentra la caja sola en la red (mDNS). Escriba su **dirección IP**
solo si no la encuentra (otra subred, multicast filtrado); lo mejor es una
dirección fija en su router. El **PIN de la caja** solo sirve para una
cuenta con varias cajas.

El interruptor **Preferir la conexión local** de Gladys (activado por
defecto) elige el canal que se prueba primero.

### Idioma

Gladys no comunica su idioma a la integración al buscar o al ejecutar una
escena: elija el idioma de los nombres de las funciones y de los errores de
las escenas.

## Uso

### Dispositivos

Abra la pestaña **Descubrir**: cada dispositivo de la caja que Gladys sabe
mostrar aparece con el nombre dado en la aplicación TaHoma. Añada los que
quiera.

| Dispositivo TaHoma                                                  | En Gladys                                                                                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Persiana, estor, screen, ventana, pérgola, puerta de garaje, portón | Persiana: abrir / parar / cerrar, posición cuando el motor la indica, lamas si las tiene                                     |
| Toldo                                                               | Persiana, posición = despliegue                                                                                              |
| Cortina                                                             | Cortina                                                                                                                      |
| Motor de un solo botón                                              | Persiana, abrir y cerrar pulsan el botón                                                                                     |
| Motor RTS                                                           | Persiana sin respuesta de estado (el RTS es unidireccional)                                                                  |
| Luz                                                                 | Luz: encendido / apagado, intensidad si es regulable                                                                         |
| Enchufe, relé, piscina                                              | Interruptor                                                                                                                  |
| Sensores                                                            | Temperatura, luminosidad, humedad, apertura, movimiento, humo, fuga de agua, batería, CO2, potencia, índice de energía (kWh) |

Las posiciones indican cuánto está abierto (100 % = abierto), como en todo
Gladys. La caja envía los cambios: no se consulta nada en bucle.

Aún no gestionados: la calefacción (termostatos, válvulas, bombas de calor),
las alarmas, las cámaras y las lámparas Hue detrás de la caja.

### Transporte

Cada dispositivo muestra una insignia **local** o **nube**. Un **punto
naranja** significa que el canal preferido no responde y que Gladys usa el
otro: la información emergente da el motivo. Gladys vuelve a probar el canal
preferido cada 5 minutos.

En modo local, nada sale de su red, salvo la lectura de los escenarios TaHoma
cada hora si hay una cuenta. En modo nube, órdenes y estados pasan por Somfy.

### Widgets

![Los widgets Persiana TaHoma, Caja TaHoma y Escenarios TaHoma (ilustración generada, no una captura de pantalla)](https://raw.githubusercontent.com/William-De71/gladys-somfy-tahoma/main/docs/assets/widgets.es.png)

- **Persiana TaHoma**: una persiana, cuánto está abierta, su estado, sus
  lamas y su posición «My», con los botones abrir, parar, «My» y cerrar.
- **Caja TaHoma**: las persianas de un vistazo, el canal en uso, el firmware,
  los dispositivos que no responden y un botón para leer de nuevo los
  estados. Gladys muestra ocho tarjetas como máximo: más allá, se muestran
  siete persianas (primero las que se mueven o están abiertas) y la última
  tarjeta nombra las demás. Ajuste: las persianas mostradas, nombres
  separados por comas, en ese orden.
- **Escenarios TaHoma**: sus escenarios TaHoma y botones para ejecutar hasta
  cuatro (ajuste: nombres separados por comas).

### Disparadores de escena

- **Una orden TaHoma ha fallado**: desde Gladys, la aplicación TaHoma o un
  escenario; variables: nombre del dispositivo, código de fallo Overkiz,
  nombre de la ejecución.
- **Un dispositivo TaHoma deja de responder o vuelve a hacerlo**: pila
  agotada, corte de luz, fuera de alcance.
- **La caja TaHoma se pierde o vuelve**: ningún canal la alcanza durante un
  minuto, o Somfy la indica desconectada.

### Acciones de escena

- **Ejecutar un escenario TaHoma**, por su nombre. En modo local, sus órdenes
  se repiten en la red local.
- **Enviar una orden TaHoma**: «My», abrir, cerrar, parar, identificar.

### Ejemplos de escenas

- Cuando la caja se pierde → enviar un mensaje: «La caja TaHoma ya no
  responde».
- Cuando falla una orden de la persiana del salón → avisar con el código de
  fallo (un obstáculo, una persiana helada).
- Al anochecer → ejecutar el escenario TaHoma «Buenas noches».

## Solución de problemas

- **Probar la conexión** indica qué canal responde y por qué el otro no.
- «Somfy rechazó el correo o la contraseña»: compruébelos en la aplicación
  TaHoma. Tras muchos fallos, Somfy bloquea las conexiones un tiempo: espere
  antes de volver a intentarlo.
- «Caja no encontrada en la red local»: escriba su dirección IP y compruebe
  que el modo desarrollador sigue activo (un reinicio de fábrica o algunas
  actualizaciones lo desactivan).
- «La caja rechazó el token local»: el token se revocó o pertenece a otra
  caja: pulse de nuevo Activar el modo local o cree uno nuevo.
- «El certificado no es el de una caja TaHoma»: la dirección no es la de su
  caja.
- Un motor RTS no muestra posición: el RTS es unidireccional, la caja no la
  conoce.
- Registros: pestaña Logs de la integración; añada
  `DEBUG=gladys-integration-sdk` al contenedor para ver el detalle del SDK.
  Informe de los problemas en
  [GitHub](https://github.com/William-De71/gladys-somfy-tahoma/issues).
