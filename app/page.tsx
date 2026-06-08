'use client';

import { BrowserProvider, Contract, formatEther } from 'ethers';
import { useEffect, useMemo, useState } from 'react';
import { CONTRACT_ABI, ROW_LABELS, SEATS_PER_ROW, TOTAL_TICKETS } from '../lib/contract';

type WalletState = {
  address: string;
  chainId: bigint;
};

type RowAvailability = boolean[];

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? '0x382172c5118f8bf73f53510d317ce36fd99d8c7f';

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

    return new BrowserProvider((window as Window & { ethereum: Parameters<typeof BrowserProvider>[0] }).ethereum);
  }

  async function getContract() {
    const provider = await getBrowserProvider();
    const signer = await provider.getSigner();
    return new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
  }

  async function refreshContractData() {
    if (!CONTRACT_ADDRESS) {
      updateStatus('Falta configurar NEXT_PUBLIC_CONTRACT_ADDRESS.', 'error');
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
      updateStatus(error instanceof Error ? error.message : 'No se pudo leer el contrato.', 'error');
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
        updateStatus('La wallet esta conectada, pero conviene usar Sepolia.', 'neutral');
      } else {
        updateStatus('Wallet conectada en Sepolia.', 'success');
      }
    } catch (error) {
      updateStatus(error instanceof Error ? error.message : 'No se pudo conectar la wallet.', 'error');
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
      updateStatus('No quedan asientos disponibles.', 'error');
      return;
    }

    const randomSeat = freeSeats[Math.floor(Math.random() * freeSeats.length)];
    setSelectedRow(randomSeat.rowIndex);
    setSelectedSeat(randomSeat.seat);
    updateStatus(`Se selecciono al azar ${ROW_LABELS[randomSeat.rowIndex]}-${randomSeat.seat}.`, 'neutral');
  }

  async function buyTicket() {
    if (!wallet) {
      updateStatus('Primero conecta MetaMask.', 'error');
      return;
    }

    if (!venueLoaded) {
      updateStatus('Todavia se estan cargando los asientos.', 'neutral');
      return;
    }

    if (!selectedSeatAvailable) {
      updateStatus('Ese asiento ya esta ocupado. Elegi otro.', 'error');
      return;
    }

    if (!ticketPriceWei) {
      updateStatus('Aun no se pudo leer el precio del ticket.', 'error');
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
      updateStatus('Transaccion enviada. Esperando confirmacion...', 'neutral');

      const receipt = await tx.wait();
      if (receipt?.status === 1) {
        updateStatus(`Compra confirmada para ${rowLabel}-${selectedSeat}.`, 'success');
        await refreshContractData();
        await refreshVenueAvailability();
      } else {
        updateStatus('La transaccion no fue confirmada.', 'error');
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
      return 'No tenes fondos suficientes en Sepolia para pagar el ticket y el gas.';
    }

    if (normalizedText.includes('missing revert data') && normalizedText.includes('estimategas')) {
      return 'No se pudo estimar el gas. Revisá saldo, red y que el asiento siga disponible.';
    }

    if (normalizedText.includes('user rejected') || normalizedText.includes('rejected the request')) {
      return 'La transaccion fue rechazada en MetaMask.';
    }

    if (normalizedText.includes('ticket sales are closed')) {
      return 'La venta de tickets ya cerro.';
    }

    if (normalizedText.includes('seat already sold')) {
      return 'Ese asiento ya fue vendido. Elegi otro.';
    }

    if (normalizedText.includes('incorrect ticket price')) {
      return 'El valor enviado no coincide con el precio del ticket.';
    }

    return errorText || 'No se pudo comprar el ticket.';
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">{eventName}</p>
          <h1>Charlas, música, comida y una noche pensada para encontrarse con la comunidad.</h1>
          <p className="lede">
            Una experiencia urbana con speakers invitados, profesores y artistas en vivo
            pensada para mezclar ideas, networking y buen morfi en un mismo lugar.
          </p>
        </div>

        <div className="heroCard">
          <div>
            <span className="label">Aforo total</span>
            <strong>{TOTAL_TICKETS} tickets</strong>
          </div>
          <div>
            <span className="label">Tickets restantes</span>
            <strong>{remainingTickets?.toString() ?? '...'}</strong>
          </div>
          <div>
            <span className="label">Valor de entrada</span>
            <strong>{ticketPriceWei ? `${formatEther(ticketPriceWei)} ETH` : '...'}</strong>
          </div>
          <div>
            <span className="label">Apertura / cierre</span>
            <strong>{deadline ? new Date(Number(deadline) * 1000).toLocaleString('es-AR') : '...'}</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <p className="sectionKicker">Entradas</p>
            <h2>Elegi la ubicacion del ticket</h2>
          </div>
          <button className="ghostButton" onClick={connectWallet} disabled={connecting || !isConfigured}>
            {connecting ? 'Conectando...' : wallet ? 'Reconectar wallet' : 'Conectar MetaMask'}
          </button>
        </div>

        <div className="connectionRow">
          <span className="pill">Sede: {eventVenue}</span>
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
                                title={taken ? `Ocupado ${label}-${seatNumber}` : `Seleccionar ${label}-${seatNumber}`}
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
              <span><i className="legendDot available" />Disponible</span>
              <span><i className="legendDot selected" />Seleccionado</span>
              <span><i className="legendDot occupied" />Ocupado</span>
            </div>
          </div>

          <div className="pickerMeta">
            <div>
              <span className="label">Sector elegido</span>
              <strong>{rowLabel}</strong>
            </div>
            <div>
              <span className="label">Ubicacion elegida</span>
              <strong>{rowLabel}-{selectedSeat}</strong>
            </div>
            <div>
              <span className="label">Disponibilidad</span>
              <strong>{loadingVenue ? 'Cargando asientos...' : venueLoaded && selectedSeatAvailable ? 'Disponible' : 'Ocupado'}</strong>
            </div>
          </div>

          <div className="actionRow">
            <button className="ghostButton" onClick={assignRandomSeat} disabled={loadingVenue || !venueLoaded}>
              Elegir lugar al azar
            </button>
            <button className="primaryButton" onClick={buyTicket} disabled={purchasing || !wallet || !venueLoaded || !selectedSeatAvailable || !ticketPriceWei}>
              {purchasing ? 'Procesando...' : `Comprar ${rowLabel}-${selectedSeat}`}
            </button>
          </div>
        </div>
      </section>

      <section className="panel infoGrid">
        <article>
          <h3>Charlas y paneles</h3>
          <p>
            Una agenda con profesores invitados, fundadores, investigadores y referentes de la escena
            digital para debatir ideas, tendencias y futuro.
          </p>
        </article>
        <article>
          <h3>Escenario y artistas</h3>
          <p>
            Cierre con bandas en vivo, visuales inmersivos y DJs invitados para extender la noche hasta el after.
          </p>
        </article>
        <article>
          <h3>Gastronomía y encuentro</h3>
          <p>
            Patio gastronómico con food trucks, cafetería de especialidad y espacios pensados para networking
            entre charlas, música y experiencias.
          </p>
        </article>
      </section>

      {status ? (
        <section className={statusTone === 'success' ? 'toast toastSuccess' : statusTone === 'error' ? 'toast toastError' : 'toast toastNeutral'}>
          <div className="toastText">
            <strong>{statusTone === 'success' ? 'Listo' : statusTone === 'error' ? 'Atencion' : 'Info'}</strong>
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
