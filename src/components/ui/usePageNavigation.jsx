import { useNavigate } from 'react-router-dom';

const usePageNavigation = () => {
  const navigate = useNavigate();
  
  const navigateToPage = (path, options = {}) => {
    console.log(`Navigating to: ${path}`);
    navigate(path, options);
  };
  
  return navigateToPage;
};

export default usePageNavigation