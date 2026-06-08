// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract FestivalBlockchainUNQ2026 is ERC721, ERC2981, Ownable {
    using Strings for uint256;

    string public constant EVENT_NAME = "Festival Blockchain UNQ 2026";
    string public constant SYMBOL = "FBUNQ26";
    uint256 public constant MAX_SUPPLY = 500;

    uint256 public immutable ticketPriceWei;
    uint256 public immutable eventDeadline;
    string private _baseTokenURI;
    uint256 private _nextTokenId = 1;

    event TicketPurchased(address indexed buyer, uint256 indexed tokenId, uint256 priceWei);
    event Withdrawal(address indexed to, uint256 amountWei);

    constructor(
        uint256 ticketPriceWei_,
        address royaltyReceiver,
        uint96 royaltyFeeBps_,
        uint256 eventDeadline_,
        string memory baseTokenURI_
    ) ERC721(EVENT_NAME, SYMBOL) Ownable(msg.sender) {
        require(ticketPriceWei_ > 0, "Ticket price must be greater than zero");
        require(royaltyReceiver != address(0), "Royalty receiver cannot be zero");
        require(royaltyFeeBps_ <= 10000, "Royalty fee too high");
        require(eventDeadline_ > block.timestamp, "Event deadline must be in the future");
        require(bytes(baseTokenURI_).length > 0, "Base token URI is required");

        ticketPriceWei = ticketPriceWei_;
        eventDeadline = eventDeadline_;
        _baseTokenURI = baseTokenURI_;
        _setDefaultRoyalty(royaltyReceiver, royaltyFeeBps_);
    }

    function buyTicket() external payable returns (uint256 tokenId) {
        require(block.timestamp <= eventDeadline, "Ticket sales are closed");
        require(msg.value == ticketPriceWei, "Incorrect ticket price");
        require(_nextTokenId <= MAX_SUPPLY, "Tickets sold out");

        tokenId = _nextTokenId;
        _nextTokenId += 1;

        _safeMint(msg.sender, tokenId);

        emit TicketPurchased(msg.sender, tokenId, msg.value);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        ownerOf(tokenId);
        return string.concat(_baseTokenURI, tokenId.toString(), ".json");
    }

    function remainingTickets() external view returns (uint256) {
        if (_nextTokenId > MAX_SUPPLY) {
            return 0;
        }
        return MAX_SUPPLY - _nextTokenId + 1;
    }

    function nextTicketId() external view returns (uint256) {
        return _nextTokenId;
    }

    function withdraw() external onlyOwner {
        uint256 balanceWei = address(this).balance;
        require(balanceWei > 0, "Nothing to withdraw");

        address payable recipient = payable(owner());
        (bool success, ) = recipient.call{value: balanceWei}("");
        require(success, "Withdrawal failed");

        emit Withdrawal(recipient, balanceWei);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            require(block.timestamp <= eventDeadline, "Transfers are closed");
        }
        return super._update(to, tokenId, auth);
    }
}
