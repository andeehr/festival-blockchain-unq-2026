# Festival Blockchain UNQ 2026

Contrato ERC-721 para 500 entradas fijas, con:

- compra directa mint-eando 1 ticket por vez
- supply maximo de 500
- metadata off-chain por tokenId
- transferencias habilitadas solo hasta la fecha del evento
- royalties del 10% via EIP-2981

Tambien incluye un front basico en Next.js listo para desplegar en Vercel, con selector de fila y asiento.

## Idea tecnica

La autenticidad del ticket la da la blockchain: el contrato, el tokenId y el owner actual.
La imagen del NFT no es la prueba de autenticidad; sirve como representacion visual del ticket.

La metadata vive fuera de la cadena, idealmente en IPFS, y el `tokenURI` apunta a:

`ipfs://<CID>/<tokenId>.json`

Cada JSON puede incluir:

- nombre del evento
- fecha
- asiento
- imagen del ticket
- atributos extra si se necesitan

## Constructor del contrato

El contrato se despliega con estos parametros:

- `ticketPriceWei`: precio fijo de cada entrada en wei
- `royaltyReceiver`: wallet que cobra el royalty
- `royaltyFeeBps`: porcentaje en basis points, por ejemplo `1000` para 10%
- `eventDeadline`: timestamp a partir del cual no se pueden comprar ni transferir tickets
- `baseTokenURI`: base de IPFS, por ejemplo `ipfs://bafy.../`

Importante: `baseTokenURI` debe terminar con `/` para que la URI final quede bien formada.

## Uso en Remix

1. Crear un archivo nuevo con el contenido de `contracts/FestivalBlockchainUNQ2026.sol`.
2. Compilar con Solidity `0.8.24` o superior compatible.
3. Desplegar en Sepolia con MetaMask.
4. Pasar los parametros del constructor.
5. Llamar a `buyTicket()` enviando exactamente el precio del ticket.

## Front en Vercel

El front espera estas variables de entorno:

- `NEXT_PUBLIC_CONTRACT_ADDRESS`

Luego:

1. Instalar dependencias con `npm install`.
2. Ejecutar `npm run dev` en local.
3. Desplegar el repo en Vercel.
4. Configurar la variable de entorno en Vercel con la address del contrato de Sepolia.

## Verificacion en entrada

Para verificar un ticket en la puerta, el check-in debe consultar on-chain:

- `ownerOf(tokenId)` para saber quien es el titular actual
- `tokenURI(tokenId)` para ver la metadata asociada
- opcionalmente, una pagina web o QR puede abrir una vista con esos datos