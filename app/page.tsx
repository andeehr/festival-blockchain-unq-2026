'use client';

import { BrowserProvider, Contract, formatEther } from 'ethers';
import { useEffect, useMemo, useState } from 'react';
import { CONTRACT_ABI, ROW_LABELS, SEATS_PER_ROW, TOTAL_TICKETS } from '../lib/contract';

type WalletState = {
  address: string;
  chainId: bigint;
};

type RowAvailability = boolean[];

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? '';

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

  const isConfigured = useMemo(() => CONTRACT_ADDRESS.length > 0, []);
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
  }, []);

  async function getBrowserProvider() {
    if (typeof window === 'undefined' || !(window as Window & { ethereum?: unknown }).ethereum) {
      throw new Error('MetaMask no esta disponible en este navegador.');
    }

    const injectedProvider = (window as Window & { ethereum?: unknown }).ethereum;
    return new BrowserProvider(injectedProvider as never);
  }

  async function getContract() {
    const provider = await getBrowserProvider();
    const signer = await provider.getSigner();
    return new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
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

      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
      const seatChecks = await Promise.all(
        Array.from({ length: TOTAL_TICKETS }, async (_, index) => contract.seatTaken(index + 1))
      );

      setAvailability(seatChecks.map((value: boolean) => Boolean(value)));
      setVenueLoaded(true);

      const firstFreeSeat = seatChecks.findIndex((taken: boolean) => !taken);
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

  async function connectWallet() {
    setConnecting(true);
    updateStatus('');

    try {
      const provider = await getBrowserProvider();
      await provider.send('eth_requestAccounts', []);
      const signer = await provider.getSigner();
      const network = await provider.getNetwork();
      const address = await signer.getAddress();

      setWallet({ address, chainId: network.chainId });
      await refreshContractData();
      await refreshVenueAvailability();

      if (network.chainId !== 11155111n) {
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

      <section className="panel">
        <div className="panelHeader">
          <div>
            <p className="sectionKicker">Entradas</p>
            <h2>Elegí tu lugar</h2>
          </div>
          <button className="ghostButton" onClick={connectWallet} disabled={connecting || !isConfigured}>
            {connecting ? 'Conectando...' : wallet ? 'Reconectar wallet' : 'Conectar MetaMask'}
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
                    <div className={rowIndex === selectedRow ? 'rowBadge active' : 'rowBadge'}>
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


      {status ? (
        <section className={statusTone === 'success' ? 'toast toastSuccess' : statusTone === 'error' ? 'toast toastError' : 'toast toastNeutral'}>
          <div className="toastText">
            <strong>{statusTone === 'success' ? 'Listo' : statusTone === 'error' ? 'Ups' : 'Dato'}</strong>
            <span>{status}</span>
            {txHash ? <span className="mono">{txHash}</span> : null}
          </div>
          <button className="toastClose" onClick={() => updateStatus('', 'neutral')} aria-label="Cerrar mensaje">
            ×
          </button>
        </section>
      ) : null}
    </main>
  );
}
