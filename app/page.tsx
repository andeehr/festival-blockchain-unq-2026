'use client';

import { BrowserProvider, Contract, formatEther, formatUnits, parseEther } from 'ethers';
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
  const [availability, setAvailability] = useState<RowAvailability>(Array.from({ length: SEATS_PER_ROW }, () => false));
  const [loadingRow, setLoadingRow] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [status, setStatus] = useState('');
  const [txHash, setTxHash] = useState('');

  const isConfigured = useMemo(() => CONTRACT_ADDRESS.length > 0, []);
  const rowLabel = ROW_LABELS[selectedRow];
  const selectedSeatAvailable = !availability[selectedSeat - 1];

  useEffect(() => {
    void refreshContractData();
  }, []);

  useEffect(() => {
    if (!wallet) {
      return;
    }

    void refreshRowAvailability(selectedRow);
  }, [wallet, selectedRow]);

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
      setStatus('Falta configurar NEXT_PUBLIC_CONTRACT_ADDRESS.');
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
      setStatus(error instanceof Error ? error.message : 'No se pudo leer el contrato.');
    }
  }

  async function connectWallet() {
    setConnecting(true);
    setStatus('');

    try {
      const provider = await getBrowserProvider();
      await provider.send('eth_requestAccounts', []);
      const signer = await provider.getSigner();
      const network = await provider.getNetwork();
      const address = await signer.getAddress();

      setWallet({ address, chainId: network.chainId });
      await refreshContractData();
      await refreshRowAvailability(selectedRow);

      if (network.chainId !== 11155111n) {
        setStatus('La wallet esta conectada, pero conviene usar Sepolia.');
      } else {
        setStatus('Wallet conectada en Sepolia.');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo conectar la wallet.');
    } finally {
      setConnecting(false);
    }
  }

  async function refreshRowAvailability(rowIndex: number) {
    if (!CONTRACT_ADDRESS) {
      return;
    }

    setLoadingRow(true);
    try {
      const provider = await getBrowserProvider();
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
      const seatChecks = await Promise.all(
        Array.from({ length: SEATS_PER_ROW }, async (_, index) => {
          const seatNumber = index + 1;
          const seatKey = rowIndex * SEATS_PER_ROW + seatNumber;
          return contract.seatTaken(seatKey);
        })
      );
      setAvailability(seatChecks.map((value: boolean) => Boolean(value)));
      const firstFreeSeat = seatChecks.findIndex((taken: boolean) => !taken);
      if (firstFreeSeat >= 0) {
        setSelectedSeat(firstFreeSeat + 1);
      }
    } catch {
      setAvailability(Array.from({ length: SEATS_PER_ROW }, () => false));
    } finally {
      setLoadingRow(false);
    }
  }

  function assignRandomSeat() {
    const freeSeats = availability
      .map((taken, index) => ({ taken, seat: index + 1 }))
      .filter((entry) => !entry.taken)
      .map((entry) => entry.seat);

    if (freeSeats.length === 0) {
      setStatus('No quedan asientos disponibles en esta fila.');
      return;
    }

    const randomSeat = freeSeats[Math.floor(Math.random() * freeSeats.length)];
    setSelectedSeat(randomSeat);
    setStatus(`Se selecciono al azar ${rowLabel}-${randomSeat}.`);
  }

  async function buyTicket() {
    if (!wallet) {
      setStatus('Primero conecta MetaMask.');
      return;
    }

    if (!selectedSeatAvailable) {
      setStatus('Ese asiento ya esta ocupado. Elegi otro.');
      return;
    }

    if (!ticketPriceWei) {
      setStatus('Aun no se pudo leer el precio del ticket.');
      return;
    }

    setPurchasing(true);
    setStatus('');
    setTxHash('');

    try {
      const contract = await getContract();
      const tx = await contract.buyTicket(selectedRow, selectedSeat, {
        value: ticketPriceWei
      });
      setTxHash(tx.hash);
      setStatus('Transaccion enviada. Esperando confirmacion...');

      const receipt = await tx.wait();
      if (receipt?.status === 1) {
        setStatus(`Compra confirmada para ${rowLabel}-${selectedSeat}.`);
        await refreshContractData();
        await refreshRowAvailability(selectedRow);
      } else {
        setStatus('La transaccion no fue confirmada.');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se pudo comprar el ticket.');
    } finally {
      setPurchasing(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Festival Blockchain UNQ 2026</p>
          <h1>Entradas NFT con ubicacion elegible, reventa permitida y metadata fuera de cadena.</h1>
          <p className="lede">
            Cada ticket es un ERC-721 unico. El usuario elige fila y asiento, el contrato evita duplicados,
            y la transferencia queda habilitada solo hasta la fecha del evento.
          </p>
        </div>

        <div className="heroCard">
          <div>
            <span className="label">Supply maximo</span>
            <strong>{TOTAL_TICKETS} tickets</strong>
          </div>
          <div>
            <span className="label">Tickets restantes</span>
            <strong>{remainingTickets?.toString() ?? '...'}</strong>
          </div>
          <div>
            <span className="label">Precio</span>
            <strong>{ticketPriceWei ? `${formatEther(ticketPriceWei)} ETH` : '...'}</strong>
          </div>
          <div>
            <span className="label">Cierre</span>
            <strong>{deadline ? new Date(Number(deadline) * 1000).toLocaleString('es-AR') : '...'}</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <div>
            <p className="sectionKicker">Compra</p>
            <h2>Elegi la ubicacion del ticket</h2>
          </div>
          <button className="ghostButton" onClick={connectWallet} disabled={connecting || !isConfigured}>
            {connecting ? 'Conectando...' : wallet ? 'Reconectar wallet' : 'Conectar MetaMask'}
          </button>
        </div>

        <div className="connectionRow">
          <span className="pill">Contrato: {CONTRACT_ADDRESS || 'no configurado'}</span>
          <span className="pill">Wallet: {wallet?.address ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}` : 'desconectada'}</span>
          <span className="pill">Red: {wallet ? `${wallet.chainId.toString()}` : 'sin red'}</span>
        </div>

        <div className="seatPicker">
          <div className="rowTabs">
            {ROW_LABELS.map((label, index) => (
              <button
                key={label}
                className={index === selectedRow ? 'rowTab active' : 'rowTab'}
                onClick={() => setSelectedRow(index)}
              >
                Fila {label}
              </button>
            ))}
          </div>

          <div className="pickerMeta">
            <div>
              <span className="label">Fila seleccionada</span>
              <strong>{rowLabel}</strong>
            </div>
            <div>
              <span className="label">Asiento seleccionado</span>
              <strong>{rowLabel}-{selectedSeat}</strong>
            </div>
            <div>
              <span className="label">Estado</span>
              <strong>{loadingRow ? 'Cargando asientos...' : selectedSeatAvailable ? 'Disponible' : 'Ocupado'}</strong>
            </div>
          </div>

          <div className="seatGrid" aria-label="Selector de asientos">
            {Array.from({ length: SEATS_PER_ROW }, (_, index) => {
              const seatNumber = index + 1;
              const taken = availability[index];
              const active = seatNumber === selectedSeat;
              return (
                <button
                  key={seatNumber}
                  className={active ? 'seat active' : taken ? 'seat taken' : 'seat'}
                  onClick={() => setSelectedSeat(seatNumber)}
                  disabled={taken}
                  title={taken ? 'Asiento ocupado' : `Seleccionar ${rowLabel}-${seatNumber}`}
                >
                  {seatNumber}
                </button>
              );
            })}
          </div>

          <div className="actionRow">
            <button className="ghostButton" onClick={assignRandomSeat} disabled={loadingRow}>
              Elegir al azar en esta fila
            </button>
            <button className="primaryButton" onClick={buyTicket} disabled={purchasing || !wallet || !selectedSeatAvailable || !ticketPriceWei}>
              {purchasing ? 'Procesando...' : `Comprar ${rowLabel}-${selectedSeat}`}
            </button>
          </div>
        </div>
      </section>

      <section className="panel infoGrid">
        <article>
          <h3>Metadata</h3>
          <p>
            La autenticidad vive en la blockchain. La metadata se guarda off-chain, idealmente en IPFS,
            y el tokenURI apunta a un JSON por ticket.
          </p>
        </article>
        <article>
          <h3>Verificacion</h3>
          <p>
            En puerta se puede leer ownerOf(tokenId) y, si hace falta, seatOfToken(tokenId) o seatLabelOf(tokenId).
          </p>
        </article>
        <article>
          <h3>Royalties</h3>
          <p>
            El contrato expone EIP-2981 con 10% para el artista, si el marketplace lo respeta.
          </p>
        </article>
      </section>

      <section className="statusBar">
        <span>{status || 'Listo para conectar y comprar.'}</span>
        {txHash ? <span className="mono">{txHash}</span> : null}
      </section>
    </main>
  );
}
