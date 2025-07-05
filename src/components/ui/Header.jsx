const Header = ({ onReturnHome, onUserInfo }) => (
    <>
        <div>+--------------------------------------------+</div>
        <div>|  <span className="clickable" onClick={onReturnHome}>E-vite</span>                            <span className="clickable" onClick={onUserInfo}>[USER]</span>  |</div>
        <div>+--------------------------------------------+</div>
        <div>|                                            |</div>
    </>
);

export default Header;