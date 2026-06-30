'use client';

import { BrowserProvider, Contract, formatEther } from 'ethers';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { CONTRACT_ABI, ROW_LABELS, SEATS_PER_ROW, TOTAL_TICKETS } from '../lib/contract';

type WalletState = {
  address: string;
  chainId: bigint;
};

type RowAvailability = boolean[];

type MyTicket = {
  tokenId: string;
  rowIndex: number;
  seatNumber: number;
  label: string;
};

type TicketPurchasedEvent = {
  args?: {
    buyer?: string;
    tokenId?: bigint;
    rowIndex?: bigint | number;
    seatNumber?: bigint | number;
  };
};

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? '';
const SEPOLIA_CHAIN_ID = 11155111n;
const SEPOLIA_CHAIN_ID_HEX = '0xaa36a7';

export default function Page() {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [ticketPriceWei, setTicketPriceWei] = useState<bigint | null>(null);
  const [deadline, setDeadline] = useState<bigint | null>(null);
  const [remainingTickets, setRemainingTickets] = useState<bigint | null>(null);
  const [selectedRow, setSelectedRow] = useState(0);
  const [selectedSeat, setSelectedSeat] = useState(1);
  const [availability, setAvailability] = useState<RowAvailability>(Array.from({ length: TOTAL_TICKETS }, () => false));
  const [venueLoaded, setVenueLoaded] = useState(false);
  const [loadingVenue, setLoadingVenue] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'neutral' | 'success' | 'error'>('neutral');
  const [txHash, setTxHash] = useState('');
  const [myTickets, setMyTickets] = useState<MyTicket[]>([]);

  const isConfigured = useMemo(() => CONTRACT_ADDRESS.length > 0, []);
  const isWrongNetwork = wallet !== null && wallet.chainId !== SEPOLIA_CHAIN_ID;
  const rowLabel = ROW_LABELS[selectedRow];
  const selectedSeatKey = selectedRow * SEATS_PER_ROW + selectedSeat - 1;
  const selectedSeatAvailable = venueLoaded && !availability[selectedSeatKey];
  const eventName = 'Festival Blockchain UNQ 2026';
  const eventVenue = 'Universidad Nacional de Quilmes, Buenos Aires';
  const eventDate = '15 de octubre de 2026';

  function updateStatus(message: string, tone: 'neutral' | 'success' | 'error' = 'neutral') {
    setStatus(message);
    setStatusTone(tone);
  }

  useEffect(() => {
    void refreshContractData();
    void refreshVenueAvailability();
    // Initial contract hydration only. User actions refresh these values later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function getBrowserProvider() {
    if (typeof window === 'undefined' || !(window as Window & { ethereum?: EthereumProvider }).ethereum) {
      throw new Error('MetaMask no esta disponible en este navegador.');
    }

    const injectedProvider = (window as Window & { ethereum?: EthereumProvider }).ethereum;
    return new BrowserProvider(injectedProvider as never);
  }

  function getInjectedProvider() {
    const injectedProvider = typeof window === 'undefined'
      ? undefined
      : (window as Window & { ethereum?: EthereumProvider }).ethereum;

    if (!injectedProvider) {
      throw new Error('MetaMask no esta disponible en este navegador.');
    }

    return injectedProvider;
  }

  async function getContract() {
    const provider = await getBrowserProvider();
    const signer = await provider.getSigner();
    return new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
  }

  async function isOnSepolia(provider: BrowserProvider): Promise<boolean> {
    const network = await provider.getNetwork();
    return network.chainId === SEPOLIA_CHAIN_ID;
  }

  function getWalletErrorCode(error: unknown) {
    return typeof error === 'object' && error !== null && 'code' in error
      ? Number((error as { code: unknown }).code)
      : null;
  }

  async function switchToSepolia() {
    const ethereum = getInjectedProvider();

    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }]
      });
    } catch (error) {
      if (getWalletErrorCode(error) !== 4902) {
        throw error;
      }

      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: SEPOLIA_CHAIN_ID_HEX,
            chainName: 'Sepolia',
            nativeCurrency: {
              name: 'Sepolia Ether',
              symbol: 'ETH',
              decimals: 18
            },
            rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
            blockExplorerUrls: ['https://sepolia.etherscan.io']
          }
        ]
      });
    }
  }

  async function requireSepolia(provider: BrowserProvider) {
    if (await isOnSepolia(provider)) {
      return provider;
    }

    updateStatus('MetaMask va a pedirte cambiar a Sepolia para continuar.', 'neutral');
    await switchToSepolia();
    return getBrowserProvider();
  }

  async function refreshContractData() {
    if (!CONTRACT_ADDRESS) {
      updateStatus('Falta cargar NEXT_PUBLIC_CONTRACT_ADDRESS.', 'error');
      return;
    }

    try {
      const provider = await getBrowserProvider().catch(() => null);
      if (!provider) {
        return;
      }

      if (!(await isOnSepolia(provider))) {
        updateStatus('Presiona Conectar MetaMask para cambiar a Sepolia y ver el contrato.', 'neutral');
        return;
      }

      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
      const [price, eventDeadline, remaining] = await Promise.all([
        contract.ticketPriceWei(),
        contract.eventDeadline(),
        contract.remainingTickets()
      ]);

      setTicketPriceWei(BigInt(price.toString()));
      setDeadline(BigInt(eventDeadline.toString()));
      setRemainingTickets(BigInt(remaining.toString()));
    } catch (error) {
      updateStatus(error instanceof Error ? error.message : 'No pudimos leer el contrato.', 'error');
    }
  }

  async function refreshVenueAvailability() {
    if (!CONTRACT_ADDRESS) {
      return;
    }

    setLoadingVenue(true);
    try {
      const provider = await getBrowserProvider().catch(() => null);
      if (!provider) {
        return;
      }

      if (!(await isOnSepolia(provider))) {
        return;
      }

      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
      const events = await contract.queryFilter(contract.filters.TicketPurchased());
      const seatChecks = Array.from({ length: TOTAL_TICKETS }, () => false);

      for (const event of events) {
        const args = (event as TicketPurchasedEvent).args;
        if (!args) continue;

        const rowIndex = Number(args.rowIndex ?? -1);
        const seatNumber = Number(args.seatNumber ?? 0);
        const seatKey = rowIndex * SEATS_PER_ROW + seatNumber - 1;

        if (seatKey >= 0 && seatKey < TOTAL_TICKETS) {
          seatChecks[seatKey] = true;
        }
      }

      setAvailability(seatChecks);
      setVenueLoaded(true);

      const firstFreeSeat = seatChecks.findIndex((taken) => !taken);
      if (firstFreeSeat >= 0) {
        setSelectedRow(Math.floor(firstFreeSeat / SEATS_PER_ROW));
        setSelectedSeat((firstFreeSeat % SEATS_PER_ROW) + 1);
      }
    } catch {
      setAvailability(Array.from({ length: TOTAL_TICKETS }, () => false));
      setVenueLoaded(false);
    } finally {
      setLoadingVenue(false);
    }
  }

  async function loadMyTickets(address: string, provider: BrowserProvider) {
    try {
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
      const filter = contract.filters.TicketPurchased(address);
      const events = await contract.queryFilter(filter);

      const tickets: MyTicket[] = [];

      for (const event of events) {
        const args = (event as { args?: { tokenId?: bigint; rowIndex?: number; seatNumber?: number } }).args;
        if (!args) continue;

        const tokenId = args.tokenId?.toString() ?? '';
        const rowIndex = Number(args.rowIndex ?? 0);
        const seatNumber = Number(args.seatNumber ?? 0);

        const currentOwner: string = await contract.ownerOf(tokenId);
        if (currentOwner.toLowerCase() !== address.toLowerCase()) continue;

        tickets.push({
          tokenId,
          rowIndex,
          seatNumber,
          label: `${ROW_LABELS[rowIndex]}-${seatNumber}`
        });
      }

      setMyTickets(tickets);
    } catch {
      setMyTickets([]);
    }
  }

  async function connectWallet() {
    setConnecting(true);
    updateStatus('');

    try {
      let provider = await getBrowserProvider();
      await provider.send('eth_requestAccounts', []);
      provider = await requireSepolia(provider);
      const signer = await provider.getSigner();
      const network = await provider.getNetwork();
      const address = await signer.getAddress();

      setWallet({ address, chainId: network.chainId });
      await refreshContractData();
      await refreshVenueAvailability();
      await loadMyTickets(address, provider);

      if (network.chainId !== SEPOLIA_CHAIN_ID) {
        updateStatus('La wallet quedó conectada, pero mejor usar Sepolia.', 'neutral');
      } else {
        updateStatus('Wallet conectada en Sepolia.', 'success');
      }
    } catch (error) {
      updateStatus(error instanceof Error ? error.message : 'No pudimos conectar la wallet.', 'error');
    } finally {
      setConnecting(false);
    }
  }

  function assignRandomSeat() {
    const freeSeats = availability
      .map((taken, index) => ({
        taken,
        rowIndex: Math.floor(index / SEATS_PER_ROW),
        seat: (index % SEATS_PER_ROW) + 1
      }))
      .filter((entry) => !entry.taken)
      .map((entry) => ({ rowIndex: entry.rowIndex, seat: entry.seat }));

    if (freeSeats.length === 0) {
      updateStatus('No quedan lugares libres.', 'error');
      return;
    }

    const randomSeat = freeSeats[Math.floor(Math.random() * freeSeats.length)];
    setSelectedRow(randomSeat.rowIndex);
    setSelectedSeat(randomSeat.seat);
    updateStatus(`Te tocó ${ROW_LABELS[randomSeat.rowIndex]}-${randomSeat.seat}.`, 'neutral');
  }

  async function buyTicket() {
    if (!wallet) {
      updateStatus('Primero conectá MetaMask.', 'error');
      return;
    }

    if (!venueLoaded) {
      updateStatus('Todavía se están cargando los lugares.', 'neutral');
      return;
    }

    if (!selectedSeatAvailable) {
      updateStatus('Ese lugar ya está ocupado. Probá otro.', 'error');
      return;
    }

    if (!ticketPriceWei) {
      updateStatus('Todavía no pudimos leer el precio.', 'error');
      return;
    }

    setPurchasing(true);
    updateStatus('', 'neutral');
    setTxHash('');

    try {
      const provider = await getBrowserProvider();
      await requireSepolia(provider);
      const contract = await getContract();
      const tx = await contract.buyTicket(selectedRow, selectedSeat, {
        value: ticketPriceWei
      });
      setTxHash(tx.hash);
      updateStatus('La transacción ya se envió. Esperando confirmación...', 'neutral');

      const receipt = await tx.wait();
      if (receipt?.status === 1) {
        updateStatus(`Compra confirmada para ${rowLabel}-${selectedSeat}.`, 'success');
        await refreshContractData();
        await refreshVenueAvailability();
        if (wallet) {
          const provider = await getBrowserProvider();
          await loadMyTickets(wallet.address, provider);
        }
      } else {
        updateStatus('La transacción no se confirmó.', 'error');
      }
    } catch (error) {
      updateStatus(getPurchaseErrorMessage(error), 'error');
    } finally {
      setPurchasing(false);
    }
  }

  function getPurchaseErrorMessage(error: unknown) {
    const errorText = error instanceof Error ? error.message : String(error);
    const normalizedText = errorText.toLowerCase();

    if (normalizedText.includes('outoffunds') || normalizedText.includes('insufficient funds')) {
      return 'No te alcanza el saldo en Sepolia para pagar el ticket y el gas.';
    }

    if (normalizedText.includes('missing revert data') && normalizedText.includes('estimategas')) {
      return 'No se pudo estimar el gas. Revisá saldo, red y si el lugar sigue libre.';
    }

    if (normalizedText.includes('user rejected') || normalizedText.includes('rejected the request')) {
      return 'Rechazaste la transacción en MetaMask.';
    }

    if (normalizedText.includes('ticket sales are closed')) {
      return 'La venta ya cerró.';
    }

    if (normalizedText.includes('seat already sold')) {
      return 'Ese lugar ya se vendió. Elegí otro.';
    }

    if (normalizedText.includes('incorrect ticket price')) {
      return 'El valor que enviaste no coincide con el precio.';
    }

    return errorText || 'No se pudo comprar la entrada.';
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">{eventName}</p>
          <h1>Nueva edición del Festival de Blockchain</h1>
          <p className="lede">
            Ahora podés comprar tu ticket directamente con tu wallet, elegir tu lugar y vivir una experiencia única en la UNQ con charlas, música y mucho más. <b>¡Nos vemos el 15 de octubre de 2026 a partir de las 20 horas!</b>
          </p>
        </div>

        <div className="heroCard">
          <div>
            <span className="label">Capacidad total</span>
            <strong>{TOTAL_TICKETS} tickets</strong>
          </div>
          <div>
            <span className="label">Entradas restantes</span>
            <strong>{remainingTickets?.toString() ?? '...'}</strong>
          </div>
          <div>
            <span className="label">Valor de la entrada</span>
            <strong>{ticketPriceWei ? `${formatEther(ticketPriceWei)} ETH` : '...'}</strong>
          </div>
          <div>
            <span className="label">Horario de cierre</span>
            <strong>{deadline ? new Date(Number(deadline) * 1000).toLocaleString('es-AR') : '...'}</strong>
          </div>
        </div>
      </section>

      {myTickets.length > 0 && (
        <section className="myTicketsSection">
          <h2 className="myTicketsTitle">Tus entradas</h2>
          <ul className="myTicketsList">
            {myTickets.map((ticket) => (
              <li key={ticket.tokenId} className="myTicketItem">
                <span className="myTicketLabel">{ticket.label}</span>
                <span className="myTicketSub">Token #{ticket.tokenId}</span>
                <a
                  className="myTicketLink"
                  href={`https://sepolia.etherscan.io/token/${CONTRACT_ADDRESS}?a=${ticket.tokenId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ver en Etherscan ↗
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <div className="panelHeader">
          <div>
            <p className="sectionKicker">Entradas</p>
            <h2>Elegí tu lugar</h2>
          </div>
          <button className="ghostButton" onClick={connectWallet} disabled={connecting || !isConfigured}>
            {!connecting && (
              <Image src="/metamask-fox.svg" alt="" width={18} height={18} className="metamaskIcon" aria-hidden="true" />
            )}
            {connecting ? 'Conectando...' : isWrongNetwork ? 'Cambiar a Sepolia' : wallet ? 'Reconectar wallet' : 'Conectar MetaMask'}
          </button>
        </div>

        <div className="connectionRow">
          <span className="pill">Lugar: {eventVenue}</span>
          <span className="pill">Fecha: {eventDate}</span>
          <span className="pill">Wallet: {wallet?.address ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}` : 'desconectada'}</span>
        </div>

        <div className="seatPicker">
          <div className="venueMap">
            <div className="stageBlock">
              <span className="stageKicker">Main Stage</span>
              <strong>Charlas, música y cierre en vivo</strong>
            </div>

            <div className="venueMapScroll">
              <div className="venueMapBody">
                {ROW_LABELS.map((label, rowIndex) => (
                  <div className="venueRow" key={label}>
                    <div
                      className={rowIndex === selectedRow ? 'rowBadge active' : 'rowBadge'}
                      onClick={() => setSelectedRow(rowIndex)}
                    >
                      <span>Fila</span>
                      <strong>{label}</strong>
                    </div>

                    <div className="rowClusters">
                      {Array.from({ length: 5 }, (_, clusterIndex) => (
                        <div className="seatCluster" key={`${label}-${clusterIndex}`}>
                          {Array.from({ length: 10 }, (_, seatOffset) => {
                            const seatNumber = clusterIndex * 10 + seatOffset + 1;
                            const seatKey = rowIndex * SEATS_PER_ROW + seatNumber - 1;
                            const taken = venueLoaded ? availability[seatKey] : false;
                            const active = rowIndex === selectedRow && seatNumber === selectedSeat;

                            return (
                              <button
                                key={seatNumber}
                                className={active ? 'seatDot active' : taken ? 'seatDot taken' : 'seatDot'}
                                onClick={() => {
                                  setSelectedRow(rowIndex);
                                  setSelectedSeat(seatNumber);
                                }}
                                disabled={loadingVenue || !venueLoaded || taken}
                                title={taken ? `Ocupado ${label}-${seatNumber}` : `Elegir ${label}-${seatNumber}`}
                              >
                                {seatNumber}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="seatLegend">
              <span><i className="legendDot available" />Libre</span>
              <span><i className="legendDot selected" />Elegido</span>
              <span><i className="legendDot occupied" />Ocupado</span>
            </div>
          </div>

          <div className="pickerMeta">
            <div>
              <span className="label">Sector</span>
              <strong>{rowLabel}</strong>
            </div>
            <div>
              <span className="label">Tu lugar</span>
              <strong>{rowLabel}-{selectedSeat}</strong>
            </div>
            <div>
              <span className="label">Estado</span>
              <strong>{loadingVenue ? 'Cargando lugares...' : venueLoaded && selectedSeatAvailable ? 'Libre' : 'Tomado'}</strong>
            </div>
          </div>

          <div className="actionRow">
            <button className="ghostButton" onClick={assignRandomSeat} disabled={loadingVenue || !venueLoaded}>
              Tirar lugar al azar
            </button>
            <button className="primaryButton" onClick={buyTicket} disabled={purchasing || !wallet || !venueLoaded || !selectedSeatAvailable || !ticketPriceWei}>
              {purchasing ? 'Procesando...' : `Comprar ${rowLabel}-${selectedSeat}`}
            </button>
          </div>
        </div>
      </section>

      <section className="credits">
        <p className="creditsLabel">Proyecto desarrollado por</p>
        <ul className="creditsList">
          <li>Ezequiel González</li>
          <li>Agustín Di Santo</li>
          <li>Andrés Mora</li>
        </ul>
      </section>

      {status ? (
        <section className={statusTone === 'success' ? 'toast toastSuccess' : statusTone === 'error' ? 'toast toastError' : 'toast toastNeutral'}>
          <div className="toastText">
            <strong>{statusTone === 'success' ? 'Listo' : statusTone === 'error' ? 'Ups' : txHash ? 'Enviado' : 'Dato'}</strong>
            <span>{status}</span>
            {txHash ? (
              <a
                className="mono toastTxLink"
                href={`https://sepolia.etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
                title="Ver en Etherscan"
              >
                {txHash.slice(0, 10)}…{txHash.slice(-8)}
              </a>
            ) : null}
          </div>
          <button className="toastClose" onClick={() => updateStatus('', 'neutral')} aria-label="Cerrar mensaje">
            ×
          </button>
        </section>
      ) : null}
    </main>
  );
}
