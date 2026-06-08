export const ROW_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;
export const SEATS_PER_ROW = 50;
export const TOTAL_TICKETS = ROW_LABELS.length * SEATS_PER_ROW;

export const CONTRACT_ABI = [
  'function buyTicket(uint8 rowIndex, uint8 seatNumber) payable returns (uint256 tokenId)',
  'function eventDeadline() view returns (uint256)',
  'function nextTicketId() view returns (uint256)',
  'function owner() view returns (address)',
  'function remainingTickets() view returns (uint256)',
  'function seatLabelOf(uint256 tokenId) view returns (string)',
  'function seatOfToken(uint256 tokenId) view returns (uint8 rowIndex, uint8 seatNumber)',
  'function seatTaken(uint16) view returns (bool)',
  'function ticketPriceWei() view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'event TicketPurchased(address indexed buyer, uint256 indexed tokenId, uint8 rowIndex, uint8 seatNumber, uint256 priceWei)',
  'event Withdrawal(address indexed to, uint256 amountWei)'
] as const;
