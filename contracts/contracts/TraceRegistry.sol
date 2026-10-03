// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title 浜の履歴書 TraceRegistry
/// @notice 記録の「指紋（ハッシュ）」と親子関係だけを残す最小のコントラクト。
///         データ本体はDBにあり、ここでは「いつ・誰が・どの指紋を残したか」を否定できない形で記録する。
contract TraceRegistry {
    address public owner;                       // 運営（協議会）
    mapping(address => bool) public isIssuer;   // 記録してよい事業者
    mapping(bytes32 => bytes32) public parentOf; // itemId => parentId（個体は 0）
    mapping(bytes32 => bytes32) public latestHash; // itemId => 最新の記録のハッシュ
    mapping(bytes32 => address) public issuerOf;   // itemId => そのIDを発行した事業者

    event IssuerSet(address indexed issuer, bool allowed);
    event ItemIssued(bytes32 indexed itemId, bytes32 indexed parentId, address indexed issuer);
    event Recorded(bytes32 indexed itemId, bytes32 dataHash, bytes32 prevHash, address indexed issuer);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier onlyIssuer() { require(isIssuer[msg.sender], "not issuer"); _; }

    constructor() { owner = msg.sender; }

    function setIssuer(address issuer, bool allowed) external onlyOwner {
        isIssuer[issuer] = allowed;
        emit IssuerSet(issuer, allowed);
    }

    /// @notice 個体ID（parentId=0）または加工品ID（parentId=親）を発行し、最初の記録を残す
    function issue(bytes32 itemId, bytes32 parentId, bytes32 dataHash) external onlyIssuer {
        require(issuerOf[itemId] == address(0), "already issued");
        if (parentId != bytes32(0)) {
            require(issuerOf[parentId] != address(0), "unknown parent");
        }
        issuerOf[itemId] = msg.sender;
        parentOf[itemId] = parentId;
        emit ItemIssued(itemId, parentId, msg.sender);
        _record(itemId, dataHash);
    }

    /// @notice 既存IDへの追記（せり・保管・出荷・訂正など）
    function record(bytes32 itemId, bytes32 dataHash) external onlyIssuer {
        require(issuerOf[itemId] != address(0), "unknown item");
        _record(itemId, dataHash);
    }

    /// @notice 複数件をまとめて記録（手数料の節約用）
    function recordBatch(bytes32[] calldata itemIds, bytes32[] calldata dataHashes) external onlyIssuer {
        require(itemIds.length == dataHashes.length, "length mismatch");
        for (uint256 i = 0; i < itemIds.length; i++) {
            require(issuerOf[itemIds[i]] != address(0), "unknown item");
            _record(itemIds[i], dataHashes[i]);
        }
    }

    function _record(bytes32 itemId, bytes32 dataHash) internal {
        bytes32 prev = latestHash[itemId];
        latestHash[itemId] = dataHash;
        emit Recorded(itemId, dataHash, prev, msg.sender);
    }
}
