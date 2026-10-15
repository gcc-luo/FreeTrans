import { observer } from 'mobx-react';
import { Component } from 'react';
import { WrappedComponentProps, defineMessages, injectIntl } from 'react-intl';
import { NavLink } from 'react-router-dom';
import RecipePreview from '../../../models/RecipePreview';
import SearchInput from '../../ui/SearchInput';
import Appear from '../../ui/effects/Appear';
import { H1 } from '../../ui/headline';
import Infobox from '../../ui/infobox/index';
import Loader from '../../ui/loader';
import RecipeItem from './RecipeItem';

const messages = defineMessages({
  headline: {
    id: 'settings.recipes.headline',
    defaultMessage: 'Available services',
  },
  searchService: {
    id: 'settings.searchService',
    defaultMessage: 'Search service',
  },
  ferdiumPicksRecipes: {
    id: 'settings.recipes.ferdiumPicks',
    defaultMessage: 'FreeTrans Picks',
  },
  allRecipes: {
    id: 'settings.recipes.all',
    defaultMessage: 'All services',
  },
  nothingFound: {
    id: 'settings.recipes.nothingFound',
    defaultMessage:
      'No translation-ready service matched your search. FreeTrans currently supports WhatsApp, Telegram, and Google Chat.',
  },
  translationGuide: {
    id: 'settings.recipes.translationGuide',
    defaultMessage:
      'Add and sign in to a service to start translating messages. You can adjust languages and translation options in the translator panel. Translation is currently adapted for WhatsApp, Telegram, and Google Chat, so only these services appear in the list and search results.',
  },
  servicesSuccessfulAddedInfo: {
    id: 'settings.recipes.servicesSuccessfulAddedInfo',
    defaultMessage: 'Service successfully added',
  },
});

interface IProps extends WrappedComponentProps {
  recipes: RecipePreview[];
  isLoading: boolean;
  hasLoadedRecipes: boolean;
  showAddServiceInterface: (...args: any[]) => void;
  searchRecipes: (e: string | null) => void;
  resetSearch: () => void;
  serviceStatus: string[];
  recipeFilter?: string;
}

@observer
class RecipesDashboard extends Component<IProps> {
  render() {
    const {
      recipes,
      isLoading,
      hasLoadedRecipes,
      showAddServiceInterface,
      searchRecipes,
      resetSearch,
      serviceStatus = 'all',
      recipeFilter,
      intl,
    } = this.props;

    return (
      <div className="settings__main">
        <div className="settings__header">
          <H1>{intl.formatMessage(messages.headline)}</H1>
        </div>
        <div className="settings__body recipes">
          {serviceStatus.length > 0 && serviceStatus.includes('created') && (
            <Appear>
              <Infobox
                type="success"
                icon="checkbox-marked-circle-outline"
                dismissible
              >
                {intl.formatMessage(messages.servicesSuccessfulAddedInfo)}
              </Infobox>
            </Appear>
          )}
          <SearchInput
            placeholder={intl.formatMessage(messages.searchService)}
            onChange={e => searchRecipes(e)}
            onReset={() => resetSearch()}
            autoFocus
            throttle
          />
          <Infobox type="primary">
            {intl.formatMessage(messages.translationGuide)}
          </Infobox>
          <div className="recipes__navigation">
            <NavLink
              to="/settings/recipes"
              className={() =>
                recipeFilter === 'featured' ? 'badge badge--primary' : 'badge'
              }
              onClick={() => resetSearch()}
            >
              {intl.formatMessage(messages.ferdiumPicksRecipes)}
            </NavLink>
            <NavLink
              to="/settings/recipes/all"
              className={({ isActive }) =>
                isActive && recipeFilter === 'all'
                  ? 'badge badge--primary'
                  : 'badge'
              }
              onClick={() => resetSearch()}
            >
              {intl.formatMessage(messages.allRecipes)}
            </NavLink>
          </div>

          {isLoading ? (
            <Loader />
          ) : (
            <>
              <div className="recipes__list">
                {recipes.map(recipe => (
                  <RecipeItem
                    key={recipe.id}
                    recipe={recipe}
                    onClick={() =>
                      showAddServiceInterface({ recipeId: recipe.id })
                    }
                  />
                ))}
              </div>
              {hasLoadedRecipes && recipes.length === 0 && (
                <div className="align-middle settings__empty-state">
                  <p className="settings__empty-state-text">
                    {intl.formatMessage(messages.nothingFound)}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }
}

export default injectIntl(RecipesDashboard);
