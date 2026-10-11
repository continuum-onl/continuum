package onl.continuum.continuum.domain.user;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import static org.assertj.core.api.Assertions.*;

class UserTest {

    @Test
    @DisplayName("theme defaults to CLASSIC and user language can be saved")
    void themeAndLanguagePreferences() {
        User user = User.builder().build();

        assertThat(user.getTheme()).isEqualTo("CLASSIC");

        user.setTheme("CHARCOAL");
        user.setLanguage("pt");
        assertThat(user.getTheme()).isEqualTo("CHARCOAL");
        assertThat(user.getLanguage()).isEqualTo("pt");

        user.setTheme("AMOLED");
        assertThat(user.getTheme()).isEqualTo("CLASSIC");
    }
}
