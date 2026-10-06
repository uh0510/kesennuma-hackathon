// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title 魚籍 TraceRegistryV2
/// @notice 記録の「指紋（ハッシュ）」と親子関係を残す。v1 との違いは、記録の種類ごとに書ける役割を決めて、チェーンで断ること。
///         例：漁獲申告は漁船の鍵だけ、水揚げ・せりは市場の鍵だけ、加工は加工場の鍵だけ、販売開始は小売の鍵だけ。
///         漁船の鍵で加工を記録しようとしても、ここで止まる。データ本体は DB にあり、ここには指紋だけを残す。
contract TraceRegistryV2 {
    // 役割（1つの鍵が複数持ってもよい）
    uint8 public constant VESSEL = 1;    // 漁船
    uint8 public constant MARKET = 2;    // 市場
    uint8 public constant PROCESSOR = 4; // 加工
    uint8 public constant RETAILER = 8;  // 小売
    uint8 public constant EXPORTER = 16; // 輸出

    // 記録の種類
    uint8 public constant CATCH = 1;   // 漁獲申告
    uint8 public constant LANDING = 2; // 水揚げ（IDの発行）
    uint8 public constant AUCTION = 3; // せり
    uint8 public constant RECEIVE = 4; // 受け取り
    uint8 public constant SHIP = 5;    // 出荷・引き渡し
    uint8 public constant PROCESS = 6; // 加工・加工品の発行・加工ロット
    uint8 public constant SELL = 7;    // 販売開始
    uint8 public constant STORAGE = 8; // 保管
    uint8 public constant FIX = 9;     // 訂正

    address public owner;                            // 運営（協議会）
    mapping(address => uint8) public rolesOf;        // 鍵 => 役割
    mapping(uint8 => uint8) public allowedRoles;     // 記録の種類 => 書ける役割
    mapping(bytes32 => bytes32) public parentOf;     // itemId => parentId（元は 0。申告から水揚げしたものは申告）
    mapping(bytes32 => bytes32) public latestHash;   // itemId => 最新の記録のハッシュ
    mapping(bytes32 => address) public issuerOf;     // itemId => そのIDを発行した鍵
    mapping(bytes32 => bytes32[]) private _inputs;   // 加工ロット => 入れた魚

    event RolesSet(address indexed account, uint8 roles);
    event AllowedSet(uint8 indexed kind, uint8 roles);
    event ItemIssued(bytes32 indexed itemId, bytes32 indexed parentId, address indexed issuer, uint8 kind);
    event MixIssued(bytes32 indexed itemId, bytes32[] inputs, address indexed issuer);
    event Recorded(bytes32 indexed itemId, bytes32 dataHash, bytes32 prevHash, address indexed issuer, uint8 kind);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier allowed(uint8 kind) { require(rolesOf[msg.sender] & allowedRoles[kind] != 0, "role not allowed"); _; }

    constructor() {
        owner = msg.sender;
        uint8 trade = MARKET | PROCESSOR | RETAILER | EXPORTER;
        _setAllowed(CATCH, VESSEL);
        _setAllowed(LANDING, MARKET);
        _setAllowed(AUCTION, MARKET);
        _setAllowed(RECEIVE, trade);
        _setAllowed(SHIP, trade);
        _setAllowed(PROCESS, PROCESSOR | RETAILER);
        _setAllowed(SELL, RETAILER);
        _setAllowed(STORAGE, trade);
        _setAllowed(FIX, trade | VESSEL);
    }

    function setRoles(address account, uint8 roles) external onlyOwner {
        rolesOf[account] = roles;
        emit RolesSet(account, roles);
    }

    function setAllowed(uint8 kind, uint8 roles) external onlyOwner { _setAllowed(kind, roles); }

    function _setAllowed(uint8 kind, uint8 roles) internal {
        allowedRoles[kind] = roles;
        emit AllowedSet(kind, roles);
    }

    /// @notice IDを発行し、最初の記録を残す（申告・水揚げ＝親なしか申告、加工品＝親）
    function issue(bytes32 itemId, bytes32 parentId, uint8 kind, bytes32 dataHash) external allowed(kind) {
        require(issuerOf[itemId] == address(0), "already issued");
        if (parentId != bytes32(0)) require(issuerOf[parentId] != address(0), "unknown parent");
        issuerOf[itemId] = msg.sender;
        parentOf[itemId] = parentId;
        emit ItemIssued(itemId, parentId, msg.sender, kind);
        _record(itemId, kind, dataHash);
    }

    /// @notice 加工ロット：何尾かの魚をまとめて1つのIDにする（入れた魚の一覧もチェーンに残す）
    function issueMix(bytes32 itemId, bytes32[] calldata inputs, bytes32 dataHash) external allowed(PROCESS) {
        require(issuerOf[itemId] == address(0), "already issued");
        require(inputs.length > 0, "no inputs");
        for (uint256 i = 0; i < inputs.length; i++) require(issuerOf[inputs[i]] != address(0), "unknown input");
        issuerOf[itemId] = msg.sender;
        _inputs[itemId] = inputs;
        emit MixIssued(itemId, inputs, msg.sender);
        _record(itemId, PROCESS, dataHash);
    }

    function inputsOf(bytes32 itemId) external view returns (bytes32[] memory) { return _inputs[itemId]; }

    /// @notice 既存IDへの追記
    function record(bytes32 itemId, uint8 kind, bytes32 dataHash) external allowed(kind) {
        require(issuerOf[itemId] != address(0), "unknown item");
        _record(itemId, kind, dataHash);
    }

    /// @notice 同じ種類の記録をまとめて（手数料の節約用）
    function recordBatch(bytes32[] calldata itemIds, uint8 kind, bytes32[] calldata dataHashes) external allowed(kind) {
        require(itemIds.length == dataHashes.length, "length mismatch");
        for (uint256 i = 0; i < itemIds.length; i++) {
            require(issuerOf[itemIds[i]] != address(0), "unknown item");
            _record(itemIds[i], kind, dataHashes[i]);
        }
    }

    function _record(bytes32 itemId, uint8 kind, bytes32 dataHash) internal {
        bytes32 prev = latestHash[itemId];
        latestHash[itemId] = dataHash;
        emit Recorded(itemId, dataHash, prev, msg.sender, kind);
    }
}
